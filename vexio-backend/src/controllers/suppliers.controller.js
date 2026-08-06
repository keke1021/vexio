const { PrismaClient } = require('@prisma/client');
const { findTenantTienda } = require('../utils/tienda');

const prisma = new PrismaClient();

const serializeDecimal = (val) => (val != null ? parseFloat(val) : null);

const serializePayment = (p) => ({ ...p, amount: serializeDecimal(p.amount) });

// pagado/pendiente NUNCA se guardan — se calculan siempre acá, sumando los
// SupplierPayment reales de la orden. `paidByCurrency` desglosa TODOS los
// pagos por moneda (para mostrar, sin sumarlos entre sí); `paid`/`pending`
// son específicamente en la moneda de la orden (o.currencyCode) — un pago en
// otra moneda (caso raro) queda visible en paidByCurrency pero no se resta
// del pendiente, porque no hay una tasa de cambio confiable de ese momento
// acá como para convertirlo sin inventar un número.
const serializeOrder = (o) => {
  const paidByCurrency = {};
  for (const p of o.payments ?? []) {
    paidByCurrency[p.currencyCode] = (paidByCurrency[p.currencyCode] ?? 0) + parseFloat(p.amount);
  }
  for (const cur of Object.keys(paidByCurrency)) {
    paidByCurrency[cur] = parseFloat(paidByCurrency[cur].toFixed(2));
  }
  const total = serializeDecimal(o.total);
  const paid = paidByCurrency[o.currencyCode] ?? 0;
  const pending = parseFloat((total - paid).toFixed(2));

  // Orígenes únicos usados por los pagos de esta orden — para que el
  // frontend pueda mostrar de dónde salió la plata (badge "Caja del local" /
  // "Cuenta externa" / ambos) sin tener que recorrer `payments` a mano.
  // [] si todavía no hay ningún pago.
  const paymentSources = [...new Set((o.payments ?? []).map((p) => p.source))];

  return {
    ...o,
    total,
    paid,
    pending,
    paidByCurrency,
    paymentSources,
    items: o.items?.map((i) => ({ ...i, unitPrice: serializeDecimal(i.unitPrice) })),
    payments: o.payments?.map(serializePayment),
  };
};

// Include estándar para traer una orden lista para serializeOrder — mismo
// shape en createOrder/getOrders/updateOrder/getSupplierById para no repetir
// selects distintos que después olviden algún campo.
const ORDER_INCLUDE = {
  items: true,
  payments: {
    include: {
      paidBy: { select: { id: true, name: true } },
      tienda: { select: { id: true, name: true } },
    },
    orderBy: { paidAt: 'desc' },
  },
};

// ─── Pagos a proveedores — helpers compartidos por createOrder (seña) y
// addOrderPayment (pago posterior) ─────────────────────────────────────────

// Valida el origen de un pago. Si es CASH_REGISTER, la sucursal tiene que
// existir (findTenantTienda, mismo criterio que cash.controller.js) y tener
// una caja abierta (mismo criterio que pos.controller.js/createSale — una
// caja por sucursal, no por tenant). Si es EXTERNAL no hay nada más que
// validar. Lanza { status, message } en vez de responder directo, para que
// el caller decida el response — así lo puede usar tanto createOrder como
// addOrderPayment sin duplicar el try/catch.
const resolvePaymentSource = async (tenantId, source, tiendaId) => {
  if (!['CASH_REGISTER', 'EXTERNAL'].includes(source)) {
    throw { status: 400, message: 'Origen de pago inválido.' };
  }
  if (source === 'EXTERNAL') return { tienda: null, openSession: null };

  if (!tiendaId) {
    throw { status: 400, message: 'Falta indicar la sucursal de la que sale el pago.' };
  }
  const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
  if (!tienda) {
    throw { status: 400, message: 'La sucursal indicada no pertenece a tu tienda.' };
  }
  const openSession = await prisma.cashSession.findFirst({
    where: { tenantId, tiendaId, closedAt: null },
  });
  if (!openSession) {
    throw { status: 409, message: `No hay una caja abierta en ${tienda.name} — abrí caja antes de registrar el pago.` };
  }
  return { tienda, openSession };
};

// Dentro de una transacción: crea el CashMovement (solo si CASH_REGISTER) +
// el SupplierPayment + su LedgerEntry. Un pago desde caja reutiliza
// type=CASH_MOVEMENT_EXPENSE (resta del balance normalmente, igual que un
// egreso manual de cash.controller.js/addMovement) y referencia el pago vía
// cashMovementId. Un pago externo es type=SUPPLIER_PAYMENT_EXTERNAL, sin
// cashSessionId ni cashMovementId — solo trazabilidad, no toca ningún saldo.
const writeSupplierPayment = async (tx, {
  tenantId, userId, orderId, amount, currencyCode, source, tiendaId, openSession, notes, description,
}) => {
  let cashMovement = null;
  if (source === 'CASH_REGISTER') {
    cashMovement = await tx.cashMovement.create({
      data: {
        type: 'EXPENSE',
        amount,
        currencyCode,
        description,
        paymentMethod: 'CASH',
        sessionId: openSession.id,
        createdById: userId,
        tenantId,
      },
    });
  }

  const payment = await tx.supplierPayment.create({
    data: {
      amount,
      currencyCode,
      source,
      purchaseOrderId: orderId,
      tenantId,
      tiendaId: source === 'CASH_REGISTER' ? tiendaId : null,
      cashMovementId: cashMovement?.id ?? null,
      paidById: userId,
      notes: notes || null,
    },
    include: {
      paidBy: { select: { id: true, name: true } },
      tienda: { select: { id: true, name: true } },
    },
  });

  await tx.ledgerEntry.create({
    data: {
      tenantId,
      currencyCode,
      amount: -amount,
      type: source === 'CASH_REGISTER' ? 'CASH_MOVEMENT_EXPENSE' : 'SUPPLIER_PAYMENT_EXTERNAL',
      cashSessionId: source === 'CASH_REGISTER' ? openSession.id : null,
      cashMovementId: cashMovement?.id ?? null,
      supplierPaymentId: source === 'EXTERNAL' ? payment.id : null,
      description,
      createdById: userId,
    },
  });

  return payment;
};

// OJO — nomenclatura: `debtByCurrency` es el valor de las órdenes PENDING
// (lo que todavía no llegó), NO la deuda financiera real con el proveedor
// (lo ya RECIBIDO y no pagado). Esa deuda real hoy vive en
// `receivedByCurrency` (ver getSupplierById) y no tiene ninguna acción de
// "pago" asociada todavía — es el mismo backlog anotado en el comentario de
// LedgerEntry/PURCHASE_ORDER del schema ("el movimiento de caja real...
// todavía no existe como acción en el sistema"). El campo se llama
// `debtByCurrency` por compatibilidad con el nombre que ya usa el frontend
// (ahora mostrado como "Pendiente de recibir", no "Deuda") — si en algún
// momento se agrega el flujo de pago a proveedor, ahí sí va a hacer falta
// una `realDebtByCurrency` (recibido − pagado) separada de esta.
//
// Desglosada por moneda — antes sumaba el `total` de todas las
// PurchaseOrder PENDING sin filtrar por currency (ARS + USD + USDT como si
// fueran el mismo número).
const withDebt = (s) => {
  const debtByCurrency = {};
  for (const o of s.purchaseOrders ?? []) {
    const cur = o.currencyCode;
    debtByCurrency[cur] = (debtByCurrency[cur] ?? 0) + parseFloat(o.total);
  }
  for (const cur of Object.keys(debtByCurrency)) {
    debtByCurrency[cur] = parseFloat(debtByCurrency[cur].toFixed(2));
  }
  return { ...s, debtByCurrency, purchaseOrders: undefined };
};

// ─── Suppliers CRUD ───────────────────────────────────────────────────────────

/**
 * GET /api/suppliers
 * Lista activos con deuda desglosada por moneda (sum de órdenes PENDING).
 */
const getSuppliers = async (req, res) => {
  try {
    const { tenantId } = req.user;

    const suppliers = await prisma.supplier.findMany({
      where: { tenantId, isActive: true },
      include: {
        purchaseOrders: {
          where: { status: 'PENDING' },
          select: { total: true, currencyCode: true },
        },
        _count: { select: { items: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ suppliers: suppliers.map(withDebt) });
  } catch (error) {
    console.error('[suppliers:getAll]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/suppliers/:id
 * Detalle del proveedor con stats de compras, desglosadas por moneda.
 */
const getSupplierById = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const supplier = await prisma.supplier.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { items: true } },
      },
    });

    if (!supplier) return res.status(404).json({ message: 'Proveedor no encontrado.' });

    const [pendingByCur, receivedByCur, byStatus, orders] = await Promise.all([
      prisma.purchaseOrder.groupBy({
        by: ['currencyCode'],
        where: { supplierId: id, tenantId, status: 'PENDING' },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.purchaseOrder.groupBy({
        by: ['currencyCode'],
        where: { supplierId: id, tenantId, status: 'RECEIVED' },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.purchaseOrder.groupBy({
        by: ['status'],
        where: { supplierId: id, tenantId },
        _count: { id: true },
      }),
      // total/pagado/pendiente por orden (nunca guardado, ver serializeOrder)
      prisma.purchaseOrder.findMany({
        where: { supplierId: id, tenantId },
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const toByCurrency = (rows) => Object.fromEntries(
      rows.map((b) => [b.currencyCode, { total: parseFloat(b._sum.total ?? 0), count: b._count.id }])
    );

    res.json({
      ...supplier,
      orders: orders.map(serializeOrder),
      stats: {
        debtByCurrency:     toByCurrency(pendingByCur),
        receivedByCurrency: toByCurrency(receivedByCur),
        ordersByStatus:     Object.fromEntries(byStatus.map((b) => [b.status, b._count.id])),
      },
    });
  } catch (error) {
    console.error('[suppliers:getById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/suppliers
 */
const createSupplier = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { name, city, paymentDays, phone, email, notes } = req.body;

    if (!name?.trim() || !city?.trim()) {
      return res.status(400).json({ message: 'Nombre y ciudad son requeridos.' });
    }

    const existing = await prisma.supplier.findUnique({
      where: { name_tenantId: { name: name.trim(), tenantId } },
    });
    if (existing) return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' });

    const supplier = await prisma.supplier.create({
      data: {
        name: name.trim(),
        city: city.trim(),
        paymentDays: parseInt(paymentDays) || 30,
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        tenantId,
      },
    });

    res.status(201).json(supplier);
  } catch (error) {
    console.error('[suppliers:create]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/suppliers/:id
 */
const updateSupplier = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;
    const { name, city, paymentDays, phone, email, notes, isActive } = req.body;

    const existing = await prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ message: 'Proveedor no encontrado.' });

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name      && { name: name.trim() }),
        ...(city      && { city: city.trim() }),
        ...(paymentDays != null && { paymentDays: parseInt(paymentDays) }),
        ...(phone     !== undefined && { phone: phone || null }),
        ...(email     !== undefined && { email: email || null }),
        ...(notes     !== undefined && { notes: notes || null }),
        ...(isActive  !== undefined && { isActive }),
      },
    });

    res.json(supplier);
  } catch (error) {
    console.error('[suppliers:update]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * DELETE /api/suppliers/:id
 * Soft delete — solo OWNER. No elimina si tiene órdenes PENDING.
 */
const deleteSupplier = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const existing = await prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ message: 'Proveedor no encontrado.' });

    const pendingOrders = await prisma.purchaseOrder.count({
      where: { supplierId: id, status: 'PENDING' },
    });
    if (pendingOrders > 0) {
      return res.status(409).json({ message: 'No se puede eliminar un proveedor con órdenes pendientes.' });
    }

    await prisma.supplier.update({ where: { id }, data: { isActive: false } });

    res.json({ message: 'Proveedor dado de baja.' });
  } catch (error) {
    console.error('[suppliers:delete]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Purchase Orders ──────────────────────────────────────────────────────────

/**
 * POST /api/suppliers/:id/orders
 * Crea una orden de compra con sus líneas de detalle. `downPayment` es
 * opcional — { amount, source, tiendaId? } — una seña pagada en el mismo
 * momento de crear la orden. Si se manda, la orden y el primer
 * SupplierPayment se crean en la misma transacción (mismas reglas que
 * POST /suppliers/orders/:id/payments, ver resolvePaymentSource/
 * writeSupplierPayment).
 */
const createOrder = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id: supplierId } = req.params;
    const { items, notes, currency, downPayment } = req.body;

    if (!items?.length) {
      return res.status(400).json({ message: 'La orden debe tener al menos un ítem.' });
    }

    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId } });
    if (!supplier) return res.status(404).json({ message: 'Proveedor no encontrado.' });

    for (const item of items) {
      if (!item.description?.trim()) return res.status(400).json({ message: 'Cada ítem requiere descripción.' });
      if (!item.quantity || parseInt(item.quantity) < 1) return res.status(400).json({ message: 'Cantidad inválida.' });
      if (!item.unitPrice || parseFloat(item.unitPrice) <= 0) return res.status(400).json({ message: 'Precio unitario inválido.' });
    }

    const validCurrencies = await prisma.currency.findMany({ where: { isActive: true }, select: { code: true } });
    const validCodes = new Set(validCurrencies.map((c) => c.code));
    const orderCurrency = validCodes.has(currency) ? currency : 'ARS';

    const total = items.reduce((sum, i) => sum + parseInt(i.quantity) * parseFloat(i.unitPrice), 0);

    const downAmount = downPayment ? parseFloat(downPayment.amount) : 0;
    const hasDownPayment = downAmount > 0;
    if (hasDownPayment && downAmount > total + 0.01) {
      return res.status(409).json({ message: 'La seña no puede superar el total de la orden.' });
    }

    // Se resuelve (y valida) la caja ANTES de abrir la transacción — mismo
    // motivo que en pos.controller.js/createSale: si la sucursal o la caja
    // no son válidas, hay que rechazar antes de tocar la DB, no a mitad de
    // la transacción.
    let sourceCtx = { tienda: null, openSession: null };
    if (hasDownPayment) {
      try {
        sourceCtx = await resolvePaymentSource(tenantId, downPayment.source, downPayment.tiendaId);
      } catch (err) {
        return res.status(err.status ?? 500).json({ message: err.message ?? 'Error al validar la seña.' });
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          total,
          currencyCode: orderCurrency,
          notes: notes || null,
          supplierId,
          tenantId,
          items: {
            create: items.map((i) => ({
              description: i.description.trim(),
              quantity: parseInt(i.quantity),
              unitPrice: parseFloat(i.unitPrice),
              // Snapshot de la moneda de la orden al momento del pedido — el
              // equipo todavía no existe como InventoryItem, así que no hay
              // "moneda original" que preservar, solo la de este pedido.
              currencyCode: orderCurrency,
            })),
          },
        },
      });

      if (hasDownPayment) {
        await writeSupplierPayment(tx, {
          tenantId,
          userId,
          orderId: created.id,
          amount: downAmount,
          currencyCode: orderCurrency,
          source: downPayment.source,
          tiendaId: downPayment.tiendaId,
          openSession: sourceCtx.openSession,
          notes: downPayment.notes,
          description: `Seña — orden de compra #${created.id.slice(-6)}`,
        });
      }

      return tx.purchaseOrder.findUniqueOrThrow({ where: { id: created.id }, include: ORDER_INCLUDE });
    });

    res.status(201).json(serializeOrder(order));
  } catch (error) {
    console.error('[suppliers:createOrder]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/suppliers/:id/orders
 * Historial de órdenes de un proveedor.
 */
const getOrders = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id: supplierId } = req.params;

    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, tenantId } });
    if (!supplier) return res.status(404).json({ message: 'Proveedor no encontrado.' });

    const orders = await prisma.purchaseOrder.findMany({
      where: { supplierId, tenantId },
      include: {
        ...ORDER_INCLUDE,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // pendingTotal desglosado por moneda — antes sumaba total de órdenes
    // PENDING en distintas monedas como si fueran el mismo número.
    const pendingTotalByCurrency = {};
    for (const o of orders) {
      if (o.status !== 'PENDING') continue;
      pendingTotalByCurrency[o.currencyCode] = (pendingTotalByCurrency[o.currencyCode] ?? 0) + parseFloat(o.total);
    }
    for (const cur of Object.keys(pendingTotalByCurrency)) {
      pendingTotalByCurrency[cur] = parseFloat(pendingTotalByCurrency[cur].toFixed(2));
    }

    res.json({ orders: orders.map(serializeOrder), pendingTotalByCurrency });
  } catch (error) {
    console.error('[suppliers:getOrders]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/suppliers/:id/orders/:orderId
 * Marca la orden como RECEIVED o CANCELLED.
 *
 * Al marcar RECEIVED se crea un LedgerEntry(type=PURCHASE_ORDER, amount
 * negativo, purchaseOrderId) — registra que se generó una deuda con el
 * proveedor, NO que salió plata de la caja en ese momento. Por eso queda
 * excluido de los balances de caja (TENANT_BALANCE_EXCLUDED_TYPES, ver
 * comentario en el schema junto a SUBSCRIPTION_PAYMENT). El pago real de esa
 * deuda es una acción separada e independiente del status de la orden —
 * ver POST /suppliers/orders/:id/payments (addOrderPayment) — puede
 * registrarse tanto antes (PENDING) como después (RECEIVED) de este paso.
 * CANCELLED no genera LedgerEntry: una orden cancelada nunca se recibió,
 * no hay deuda que registrar.
 */
const updateOrder = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id: supplierId, orderId } = req.params;
    const { status, notes } = req.body;

    if (!['RECEIVED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ message: 'Estado inválido. Debe ser RECEIVED o CANCELLED.' });
    }

    const order = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, supplierId, tenantId },
    });
    if (!order) return res.status(404).json({ message: 'Orden no encontrada.' });
    if (order.status !== 'PENDING') {
      return res.status(409).json({ message: 'Solo se pueden modificar órdenes en estado PENDING.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status,
          receivedAt: status === 'RECEIVED' ? new Date() : null,
          ...(notes !== undefined && { notes: notes || order.notes }),
        },
        include: ORDER_INCLUDE,
      });

      if (status === 'RECEIVED') {
        await tx.ledgerEntry.create({
          data: {
            tenantId,
            currencyCode: order.currencyCode,
            amount: -parseFloat(order.total),
            type: 'PURCHASE_ORDER',
            purchaseOrderId: order.id,
            description: `Recepción de orden de compra — deuda generada con el proveedor (pago pendiente, no afecta caja)`,
            createdById: userId,
          },
        });
      }

      return result;
    });

    res.json(serializeOrder(updated));
  } catch (error) {
    console.error('[suppliers:updateOrder]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Pagos a proveedores ──────────────────────────────────────────────────────

/**
 * POST /api/suppliers/orders/:id/payments
 * Body: { amount, currency?, source, tiendaId?, notes? }
 * Registra un pago (seña o saldo) contra una orden existente — PENDING o
 * RECEIVED, el status de la orden no lo bloquea (son eventos
 * independientes, ver comentario en updateOrder). CANCELLED sí se rechaza:
 * una orden cancelada no tiene deuda que pagar.
 * source=CASH_REGISTER / EXTERNAL: ver resolvePaymentSource/
 * writeSupplierPayment más arriba — mismas reglas que la seña de
 * createOrder.
 */
const addOrderPayment = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id: orderId } = req.params;
    const { amount, currency, source, tiendaId, notes } = req.body;

    const order = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
      include: ORDER_INCLUDE,
    });
    if (!order) return res.status(404).json({ message: 'Orden no encontrada.' });
    if (order.status === 'CANCELLED') {
      return res.status(409).json({ message: 'No se puede registrar un pago sobre una orden cancelada.' });
    }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ message: 'El monto debe ser mayor a 0.' });
    }

    const validCurrencies = await prisma.currency.findMany({ where: { isActive: true }, select: { code: true } });
    const validCodes = new Set(validCurrencies.map((c) => c.code));
    const payCurrency = validCodes.has(currency) ? currency : order.currencyCode;

    // El pendiente solo tiene sentido comparado en la misma moneda de la
    // orden (ver serializeOrder) — un pago en otra moneda no se puede
    // validar contra ese número sin inventar una tasa, así que no se
    // bloquea (mismo criterio que el desglose que se muestra al usuario).
    if (payCurrency === order.currencyCode) {
      const { pending } = serializeOrder(order);
      if (parsedAmount > pending + 0.01) {
        return res.status(409).json({
          message: `El pago (${parsedAmount}) supera el pendiente de la orden (${pending.toFixed(2)} ${order.currencyCode}).`,
        });
      }
    }

    let sourceCtx;
    try {
      sourceCtx = await resolvePaymentSource(tenantId, source, tiendaId);
    } catch (err) {
      return res.status(err.status ?? 500).json({ message: err.message ?? 'Error al validar el pago.' });
    }

    const payment = await prisma.$transaction((tx) => writeSupplierPayment(tx, {
      tenantId,
      userId,
      orderId: order.id,
      amount: parsedAmount,
      currencyCode: payCurrency,
      source,
      tiendaId,
      openSession: sourceCtx.openSession,
      notes,
      description: `Pago a proveedor — orden de compra #${order.id.slice(-6)}`,
    }));

    res.status(201).json(serializePayment(payment));
  } catch (error) {
    console.error('[suppliers:addOrderPayment]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier,
  createOrder, getOrders, updateOrder, addOrderPayment,
};
