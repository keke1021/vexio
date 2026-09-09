const { PrismaClient } = require('@prisma/client');
const { findTenantTienda } = require('../utils/tienda');
const { assertTiendaAccess } = require('../utils/tiendaAuth');
const { notify } = require('../utils/notify');

const prisma = new PrismaClient();

// ─── Errores de conflicto (mismo idioma que SaleConflictError en pos.controller.js) ─

// Se lanza DENTRO de la transacción cuando el updateMany condicionado por
// status='AVAILABLE' afecta 0 filas — significa que, entre el chequeo
// optimista de arriba y este punto, el equipo dejó de estar disponible
// (vendido, agregado a otro lote, etc.) por otra request concurrente.
class ItemNotAvailableError extends Error {
  constructor(imei) { super('ITEM_NOT_AVAILABLE'); this.imei = imei; }
}
// El lote pasó a DISPATCHED (o se canceló) entre que se resolvió cuál lote
// usar y que se intentó agregar el ítem — carrera con un dispatch concurrente.
class TransferNotOpenError extends Error {}
// Se intentó despachar un lote sin ítems.
class EmptyLotError extends Error {}
// El ítem puntual ya no está DISPATCHED (ya fue recibido/cancelado, o no
// pertenece a este lote) al momento de intentar recibirlo.
class ItemNotDispatchedError extends Error {}
// El ítem puntual ya está en un estado terminal (RECEIVED/CANCELLED) al
// momento de intentar cancelarlo.
class ItemNotCancellableError extends Error {}

// ─── Includes / serialización ──────────────────────────────────────────────────

const TIENDA_SELECT = { select: { id: true, name: true } };
const USER_SELECT = { select: { id: true, name: true } };

const TRANSFER_ITEM_INCLUDE = {
  inventoryItem: { include: { product: true } },
  addedBy: USER_SELECT,
  receivedBy: USER_SELECT,
  cancelledBy: USER_SELECT,
};

const TRANSFER_INCLUDE = {
  fromTienda: TIENDA_SELECT,
  toTienda: TIENDA_SELECT,
  delivery: true,
  createdBy: USER_SELECT,
  dispatchedBy: USER_SELECT,
  transferItems: { include: TRANSFER_ITEM_INCLUDE, orderBy: { createdAt: 'asc' } },
};

// itemsSummary: conteo por status ({ PREPARING: 2, DISPATCHED: 1, ... }) para
// que el frontend arme badges tipo "3/5 recibidos" sin queries extra.
const serializeTransfer = (t) => ({
  ...t,
  itemsSummary: (t.transferItems ?? []).reduce((acc, it) => {
    acc[it.status] = (acc[it.status] ?? 0) + 1;
    return acc;
  }, {}),
});

// ─── Helpers internos ───────────────────────────────────────────────────────────

// Busca el lote OPEN de esta combinación origen→destino, o crea uno nuevo.
// Se ejecuta FUERA de cualquier transacción a propósito: un P2002 (choque
// contra el índice único parcial StockTransfer_open_lane_unique) dentro de
// una transacción Postgres la deja abortada para cualquier statement
// posterior, incluido un findFirst de auto-recuperación — así que la
// resolución del lote y el agregado del ítem son dos pasos separados (ver
// addItem). Bajo dos altas concurrentes para la misma combinación, la
// segunda create() falla con P2002 acá — se recupera re-consultando el que
// ya quedó creado por la otra request, sin exponerle el conflicto al usuario
// (a diferencia de openCash, acá no es un conflicto de negocio real).
const resolveOpenTransfer = async (tenantId, fromTiendaId, toTiendaId, userId) => {
  const existing = await prisma.stockTransfer.findFirst({
    where: { tenantId, fromTiendaId, toTiendaId, status: 'OPEN' },
  });
  if (existing) return existing;

  try {
    return await prisma.stockTransfer.create({
      data: { tenantId, fromTiendaId, toTiendaId, createdById: userId },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      const wonByOther = await prisma.stockTransfer.findFirst({
        where: { tenantId, fromTiendaId, toTiendaId, status: 'OPEN' },
      });
      if (wonByOther) return wonByOther;
    }
    throw error;
  }
};

// Toma el row lock (SELECT ... FOR UPDATE) del header del lote y, si ya no
// queda ningún ítem vivo (PREPARING/DISPATCHED), lo cierra. El lock es lo que
// evita el lost-update: si dos mutaciones de ítems del mismo lote (ej. un
// receive y un cancel simultáneos sobre dos ítems distintos) corrieran cada
// una su propio conteo sin este lock, ambas podrían ver "queda 1 vivo"
// (el cambio de la otra todavía no committeado) y ninguna cerraría el lote
// aunque, una vez que las dos terminan, en realidad no quede nada pendiente.
// El auto-cierre a CLOSED solo aplica si el header ya está DISPATCHED — un
// lote OPEN nunca se cierra solo (ver comentario en schema.prisma).
// Debe llamarse DENTRO de la misma transacción que mutó el/los ítems.
const closeIfFullyResolved = async (tx, transferId) => {
  const rows = await tx.$queryRaw`SELECT status FROM "StockTransfer" WHERE id = ${transferId} FOR UPDATE`;
  const current = rows[0];
  if (!current || current.status !== 'DISPATCHED') return;

  const liveCount = await tx.stockTransferItem.count({
    where: { transferId, status: { in: ['PREPARING', 'DISPATCHED'] } },
  });
  if (liveCount === 0) {
    await tx.stockTransfer.update({
      where: { id: transferId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }
};

const fetchTransfer = (id, tenantId) =>
  prisma.stockTransfer.findFirst({ where: { id, tenantId }, include: TRANSFER_INCLUDE });

// ─── Lotes ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/stock-transfers/items
 * Body: { inventoryItemId, toTiendaId }
 * Agrega un IMEI al lote OPEN hacia toTiendaId (lo crea si no existe uno).
 * fromTiendaId se deriva de la ubicación actual del equipo, no lo manda el
 * cliente. El equipo pasa a IN_TRANSIT de inmediato — deja de venderse en el
 * origen aunque el lote todavía no se haya despachado.
 */
const addItem = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { inventoryItemId, toTiendaId } = req.body;

    if (!inventoryItemId || !toTiendaId) {
      return res.status(400).json({ message: 'Falta indicar el equipo y la sucursal destino.' });
    }

    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId },
      include: { tienda: { select: { id: true, name: true } } },
    });
    if (!item) return res.status(404).json({ message: 'Equipo no encontrado.' });

    const fromTiendaId = item.tiendaId;
    if (fromTiendaId === toTiendaId) {
      return res.status(400).json({ message: 'El equipo ya está en esa sucursal.' });
    }

    const toTienda = await findTenantTienda(prisma, tenantId, toTiendaId);
    if (!toTienda) return res.status(400).json({ message: 'La sucursal destino no pertenece a tu tienda.' });

    if (!assertTiendaAccess(req.user, fromTiendaId)) {
      return res.status(403).json({
        message: `Tu usuario no está asignado a ${item.tienda.name} — no podés sacar equipos de ahí.`,
      });
    }

    if (item.status !== 'AVAILABLE') {
      return res.status(409).json({
        message: `El equipo ${item.imei} no está disponible para transferir (status actual: ${item.status}).`,
      });
    }

    const transfer = await resolveOpenTransfer(tenantId, fromTiendaId, toTiendaId, userId);

    await prisma.$transaction(async (tx) => {
      // Row lock sobre el header: si un dispatch concurrente ganó la
      // carrera y ya cerró este lote a DISPATCHED, no corresponde seguir
      // agregando ítems PREPARING acá — se corta y el caller reintenta
      // (resolverá o creará un lote OPEN nuevo).
      const rows = await tx.$queryRaw`SELECT status FROM "StockTransfer" WHERE id = ${transfer.id} FOR UPDATE`;
      if (!rows[0] || rows[0].status !== 'OPEN') throw new TransferNotOpenError();

      // Mismo patrón que createSale/SaleConflictError: update condicionado
      // por status, el count de filas afectadas es la guarda real contra la
      // carrera (no el chequeo optimista de arriba).
      const updateResult = await tx.inventoryItem.updateMany({
        where: { id: inventoryItemId, tenantId, status: 'AVAILABLE' },
        data: { status: 'IN_TRANSIT', currentTransferId: transfer.id },
      });
      if (updateResult.count !== 1) throw new ItemNotAvailableError(item.imei);

      await tx.stockTransferItem.create({
        data: { transferId: transfer.id, inventoryItemId, addedById: userId },
      });
    });

    const full = await fetchTransfer(transfer.id, tenantId);
    res.status(201).json(serializeTransfer(full));
  } catch (error) {
    if (error instanceof TransferNotOpenError) {
      return res.status(409).json({ message: 'El lote se cerró justo antes de agregar este equipo — probá de nuevo.' });
    }
    if (error instanceof ItemNotAvailableError) {
      return res.status(409).json({
        message: `El equipo ${error.imei} ya no está disponible — alguien más lo vendió o lo agregó a otra transferencia justo antes.`,
      });
    }
    console.error('[stockTransfers:addItem]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/stock-transfers/open?toTiendaId=
 * Preview del lote OPEN desde la SUCURSAL ACTIVA hacia toTiendaId, si existe —
 * para que la UI muestre "ya tiene 3 ítems" antes de agregar el primero.
 * El origen es siempre la sucursal activa (transferís desde tu sucursal).
 */
const getOpenLot = async (req, res) => {
  try {
    const { tenantId, tiendaId: fromTiendaId } = req.user;
    const { toTiendaId } = req.query;

    if (!toTiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal destino.' });
    }
    if (toTiendaId === fromTiendaId) {
      return res.status(400).json({ message: 'El origen y el destino no pueden ser la misma sucursal.' });
    }

    const toTienda = await findTenantTienda(prisma, tenantId, toTiendaId);
    if (!toTienda) {
      return res.status(400).json({ message: 'La sucursal destino no pertenece a tu tienda.' });
    }

    const transfer = await prisma.stockTransfer.findFirst({
      where: { tenantId, fromTiendaId, toTiendaId, status: 'OPEN' },
      include: TRANSFER_INCLUDE,
    });

    res.json({ transfer: transfer ? serializeTransfer(transfer) : null });
  } catch (error) {
    console.error('[stockTransfers:getOpenLot]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/stock-transfers/:id/dispatch
 * Body: { deliveryId } o { newDelivery: { name, phone } } (alta rápida).
 * Cierra el lote (OPEN→DISPATCHED): exige al menos un ítem y un delivery
 * asociado. A partir de acá no se pueden agregar más ítems.
 */
const dispatch = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id } = req.params;
    const { deliveryId, newDelivery } = req.body;

    const transfer = await prisma.stockTransfer.findFirst({ where: { id, tenantId } });
    if (!transfer) return res.status(404).json({ message: 'Transferencia no encontrada.' });

    if (!assertTiendaAccess(req.user, transfer.fromTiendaId)) {
      return res.status(403).json({ message: 'Tu usuario no está asignado a la sucursal de origen de este lote.' });
    }
    if (transfer.status !== 'OPEN') {
      return res.status(409).json({ message: 'Este lote ya fue despachado o cerrado.' });
    }

    let resolvedDeliveryId = deliveryId || null;
    if (!resolvedDeliveryId && newDelivery?.name?.trim() && newDelivery?.phone?.trim()) {
      const created = await prisma.delivery.create({
        data: { name: newDelivery.name.trim(), phone: newDelivery.phone.trim(), tenantId },
      });
      resolvedDeliveryId = created.id;
    }
    if (!resolvedDeliveryId) {
      return res.status(400).json({ message: 'Falta indicar el delivery que retira el lote.' });
    }
    const delivery = await prisma.delivery.findFirst({ where: { id: resolvedDeliveryId, tenantId } });
    if (!delivery) return res.status(400).json({ message: 'El delivery indicado no existe o no pertenece a tu tienda.' });

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`SELECT status FROM "StockTransfer" WHERE id = ${id} FOR UPDATE`;
      if (!rows[0] || rows[0].status !== 'OPEN') throw new TransferNotOpenError();

      const preparingCount = await tx.stockTransferItem.count({ where: { transferId: id, status: 'PREPARING' } });
      if (preparingCount === 0) throw new EmptyLotError();

      await tx.stockTransferItem.updateMany({
        where: { transferId: id, status: 'PREPARING' },
        data: { status: 'DISPATCHED' },
      });

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: 'DISPATCHED',
          deliveryId: resolvedDeliveryId,
          dispatchedById: userId,
          dispatchedAt: new Date(),
        },
        include: TRANSFER_INCLUDE,
      });
    });

    // Notificar a los vendedores de la sucursal de destino: hay un lote en
    // camino para recibir. Best-effort — no vuelca el despacho si falla.
    const dispatchedCount = (result.transferItems ?? []).filter((it) => it.status === 'DISPATCHED').length;
    const recipients = await prisma.user.findMany({
      where: { tenantId, tiendaId: result.toTiendaId, role: 'SELLER', isActive: true, id: { not: userId } },
      select: { id: true },
    });
    await notify({
      tenantId,
      userIds: recipients.map((u) => u.id),
      message: `Transferencia en camino a ${result.toTienda.name} desde ${result.fromTienda.name}: ${dispatchedCount} equipo${dispatchedCount === 1 ? '' : 's'} para recibir.`,
      type: 'INFO',
      link: `/transfers/${result.id}`,
    });

    res.json(serializeTransfer(result));
  } catch (error) {
    if (error instanceof TransferNotOpenError) {
      return res.status(409).json({ message: 'Este lote ya fue despachado o cerrado.' });
    }
    if (error instanceof EmptyLotError) {
      return res.status(400).json({ message: 'El lote no tiene ítems para despachar.' });
    }
    console.error('[stockTransfers:dispatch]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/stock-transfers/:id/items/:itemId/receive
 * Recepción parcial de UN ítem — el resto del lote sigue DISPATCHED.
 */
const receiveItem = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id, itemId } = req.params;

    const transfer = await prisma.stockTransfer.findFirst({ where: { id, tenantId } });
    if (!transfer) return res.status(404).json({ message: 'Transferencia no encontrada.' });

    if (!assertTiendaAccess(req.user, transfer.toTiendaId)) {
      return res.status(403).json({ message: 'Tu usuario no está asignado a la sucursal destino de este lote.' });
    }

    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.stockTransferItem.updateMany({
        where: { id: itemId, transferId: id, status: 'DISPATCHED' },
        data: { status: 'RECEIVED', receivedById: userId, receivedAt: new Date() },
      });
      if (updateResult.count !== 1) throw new ItemNotDispatchedError();

      const transferItem = await tx.stockTransferItem.findUniqueOrThrow({ where: { id: itemId } });

      await tx.inventoryItem.updateMany({
        where: { id: transferItem.inventoryItemId, currentTransferId: id, status: 'IN_TRANSIT' },
        data: { status: 'AVAILABLE', tiendaId: transfer.toTiendaId, currentTransferId: null },
      });

      await closeIfFullyResolved(tx, id);
    });

    const full = await fetchTransfer(id, tenantId);
    res.json(serializeTransfer(full));
  } catch (error) {
    if (error instanceof ItemNotDispatchedError) {
      return res.status(409).json({ message: 'Este ítem ya fue recibido o cancelado, o no está en camino en este lote.' });
    }
    console.error('[stockTransfers:receiveItem]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/stock-transfers/:id/receive-all
 * "Aceptar lote completo" — atómico: dos updateMany condicionados dentro de
 * la misma transacción (no un loop por ítem), ver comentario de diseño en
 * closeIfFullyResolved/receiveItem. Si algo no llegó en realidad, no se
 * reabre — se resuelve con una transferencia inversa (mismo criterio que un
 * ítem ya RECIBIDO que no se puede cancelar).
 */
const receiveAll = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id } = req.params;

    const transfer = await prisma.stockTransfer.findFirst({ where: { id, tenantId } });
    if (!transfer) return res.status(404).json({ message: 'Transferencia no encontrada.' });

    if (!assertTiendaAccess(req.user, transfer.toTiendaId)) {
      return res.status(403).json({ message: 'Tu usuario no está asignado a la sucursal destino de este lote.' });
    }
    if (transfer.status !== 'DISPATCHED') {
      return res.status(409).json({ message: 'Este lote no está en camino — no hay nada para aceptar.' });
    }

    await prisma.$transaction(async (tx) => {
      const receivedAt = new Date();
      await tx.stockTransferItem.updateMany({
        where: { transferId: id, status: 'DISPATCHED' },
        data: { status: 'RECEIVED', receivedById: userId, receivedAt },
      });
      await tx.inventoryItem.updateMany({
        where: { currentTransferId: id, status: 'IN_TRANSIT' },
        data: { status: 'AVAILABLE', tiendaId: transfer.toTiendaId, currentTransferId: null },
      });
      await closeIfFullyResolved(tx, id);
    });

    const full = await fetchTransfer(id, tenantId);
    res.json(serializeTransfer(full));
  } catch (error) {
    console.error('[stockTransfers:receiveAll]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/stock-transfers/:id/items/:itemId/cancel
 * Body: { reason }
 * Cancela un ítem individual desde PREPARING o DISPATCHED (nunca desde
 * RECEIVED). Autorización: origen O destino (cualquiera de los dos puede
 * detectar el problema — el origen si el delivery nunca lo retiró, el
 * destino si nunca llegó).
 */
const cancelItem = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id, itemId } = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) return res.status(400).json({ message: 'El motivo de la cancelación es obligatorio.' });

    const transfer = await prisma.stockTransfer.findFirst({ where: { id, tenantId } });
    if (!transfer) return res.status(404).json({ message: 'Transferencia no encontrada.' });

    const canAccess =
      assertTiendaAccess(req.user, transfer.fromTiendaId) || assertTiendaAccess(req.user, transfer.toTiendaId);
    if (!canAccess) {
      return res.status(403).json({ message: 'Tu usuario no está asignado a ninguna de las sucursales de esta transferencia.' });
    }

    await prisma.$transaction(async (tx) => {
      const updateResult = await tx.stockTransferItem.updateMany({
        where: { id: itemId, transferId: id, status: { in: ['PREPARING', 'DISPATCHED'] } },
        data: { status: 'CANCELLED', cancelledById: userId, cancelledAt: new Date(), cancelReason: reason.trim() },
      });
      if (updateResult.count !== 1) throw new ItemNotCancellableError();

      const transferItem = await tx.stockTransferItem.findUniqueOrThrow({ where: { id: itemId } });

      // Vuelve a estar disponible en el ORIGEN — tiendaId nunca cambió
      // mientras estuvo IN_TRANSIT, así que no hace falta tocarlo acá.
      await tx.inventoryItem.updateMany({
        where: { id: transferItem.inventoryItemId, currentTransferId: id, status: 'IN_TRANSIT' },
        data: { status: 'AVAILABLE', currentTransferId: null },
      });

      await closeIfFullyResolved(tx, id);
    });

    const full = await fetchTransfer(id, tenantId);
    res.json(serializeTransfer(full));
  } catch (error) {
    if (error instanceof ItemNotCancellableError) {
      return res.status(409).json({ message: 'Este ítem ya fue recibido o cancelado — no se puede cancelar de nuevo.' });
    }
    console.error('[stockTransfers:cancelItem]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/stock-transfers?direction=incoming|outgoing&status=
 * SIEMPRE scopeado a la sucursal activa del JWT: se listan solo los lotes que
 * TOCAN esa sucursal (como origen o destino). Ya no hay vista combinada de
 * todo el tenant. `direction` acota a salientes (origen) o entrantes (destino).
 * (TECH no accede a este módulo — gate a nivel de ruta.)
 */
const getTransfers = async (req, res) => {
  try {
    const { tenantId, tiendaId } = req.user;
    const { direction, status, page = 1, pageSize = 20 } = req.query;

    let tiendaFilter;
    if (direction === 'outgoing') tiendaFilter = { fromTiendaId: tiendaId };
    else if (direction === 'incoming') tiendaFilter = { toTiendaId: tiendaId };
    else tiendaFilter = { OR: [{ fromTiendaId: tiendaId }, { toTiendaId: tiendaId }] };

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const pageSizeNum = Math.max(parseInt(pageSize) || 20, 1);
    const where = { tenantId, ...tiendaFilter, ...(status && { status }) };

    const [transfers, total] = await prisma.$transaction([
      prisma.stockTransfer.findMany({
        where,
        include: TRANSFER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    res.json({
      transfers: transfers.map(serializeTransfer),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.max(Math.ceil(total / pageSizeNum), 1),
    });
  } catch (error) {
    console.error('[stockTransfers:getTransfers]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/stock-transfers/:id
 */
const getTransferById = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const transfer = await fetchTransfer(id, tenantId);
    if (!transfer) return res.status(404).json({ message: 'Transferencia no encontrada.' });

    const canAccess =
      assertTiendaAccess(req.user, transfer.fromTiendaId) || assertTiendaAccess(req.user, transfer.toTiendaId);
    if (!canAccess) {
      return res.status(403).json({ message: 'Tu usuario no está asignado a ninguna de las sucursales de esta transferencia.' });
    }

    res.json(serializeTransfer(transfer));
  } catch (error) {
    console.error('[stockTransfers:getTransferById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Deliveries ───────────────────────────────────────────────────────────────

/**
 * GET /api/stock-transfers/deliveries
 * Catálogo de fleteros del tenant — no toca ninguna sucursal (compartido
 * entre todas), sin lógica de assertTiendaAccess.
 */
const getDeliveries = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const deliveries = await prisma.delivery.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ deliveries });
  } catch (error) {
    console.error('[stockTransfers:getDeliveries]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/stock-transfers/deliveries
 * Body: { name, phone }
 */
const createDelivery = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { name, phone } = req.body;

    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ message: 'Nombre y teléfono son requeridos.' });
    }

    const delivery = await prisma.delivery.create({
      data: { name: name.trim(), phone: phone.trim(), tenantId },
    });
    res.status(201).json(delivery);
  } catch (error) {
    console.error('[stockTransfers:createDelivery]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PATCH /api/stock-transfers/deliveries/:id
 * Body: { name?, phone?, isActive? }
 */
const updateDelivery = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;
    const { name, phone, isActive } = req.body;

    const existing = await prisma.delivery.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ message: 'Delivery no encontrado.' });

    const updated = await prisma.delivery.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(phone !== undefined && { phone: phone.trim() }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('[stockTransfers:updateDelivery]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  addItem, getOpenLot, dispatch, receiveItem, receiveAll, cancelItem,
  getTransfers, getTransferById,
  getDeliveries, createDelivery, updateDelivery,
};
