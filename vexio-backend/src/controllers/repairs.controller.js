const { PrismaClient } = require('@prisma/client');
const { notify } = require('../utils/notify');

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// A quién le toca responder en el thread, según el último comentario:
//   - último comentario del taller (fromTech)      → 'EMPLEADO'
//   - último comentario del mostrador (!fromTech)  → 'TECNICO'
//   - sin comentarios                              → null
const awaitingReplyFrom = (comments) => {
  if (!comments || comments.length === 0) return null;
  const last = comments[comments.length - 1];
  return last.fromTech ? 'EMPLEADO' : 'TECNICO';
};

const serializeRepair = (repair) => ({
  ...repair,
  budget: repair.budget != null ? parseFloat(repair.budget) : null,
  ...(repair.comments !== undefined && { awaitingReplyFrom: awaitingReplyFrom(repair.comments) }),
});

// ── Dos dimensiones de scope, independientes entre sí ──────────────────────
// ROL (quién) — para MODIFICAR: un TECH solo edita/avanza/borra las órdenes que
// tomó (technicianId === él). No puede tocar el pool sin asignar hasta tomarlo.
const roleScope = (role, userId) =>
  role === 'TECH' ? { technicianId: userId } : {};

// ROL (quién) — para VER / comentar / tomar: en el modelo pull el TECH además
// del propio ve el POOL sin asignar (technicianId null) para poder tomarlo.
const visibilityScope = (role, userId) =>
  role === 'TECH' ? { OR: [{ technicianId: userId }, { technicianId: null }] } : {};

class RepairAlreadyTakenError extends Error {}

// SUCURSAL (de dónde es el equipo): OWNER/ADMIN/SELLER ven solo las órdenes de
// su sucursal activa. TECH es la EXCEPCIÓN EXPLÍCITA: ve las de TODAS las
// sucursales combinadas (el taller es uno solo y recibe equipos de todas), sin
// elegir ninguna — cada orden igual expone su tiendaId de origen.
const branchScope = (req) =>
  req.user.role === 'TECH' || req.user.role === 'SUPERADMIN'
    ? {}
    : { tiendaId: req.user.tiendaId };

const TIENDA_SELECT = { select: { id: true, name: true } };

const REPAIR_DETAIL_INCLUDE = {
  technician: { select: { id: true, name: true, role: true } },
  createdBy: { select: { id: true, name: true } },
  tienda: TIENDA_SELECT,
  customer: true,
  statusHistory: {
    include: { changedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
  comments: {
    include: { author: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  },
};

// ─── Stats (usada por el badge del Layout) ────────────────────────────────────

/**
 * GET /api/repairs/stats
 * Retorna conteos ligeros para el badge de la navegación.
 */
const getStats = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    // El badge del TECH incluye el pool sin asignar (trabajo disponible para tomar).
    const scope = { ...visibilityScope(role, userId), ...branchScope(req) };

    const [active, ready] = await prisma.$transaction([
      prisma.repairOrder.count({
        where: { tenantId, ...scope, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      }),
      prisma.repairOrder.count({
        where: { tenantId, ...scope, status: 'READY' },
      }),
    ]);

    res.json({ active, ready });
  } catch (error) {
    console.error('[repairs:getStats]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Technicians list (para select en formularios) ────────────────────────────

/**
 * GET /api/repairs/technicians
 */
const getTechnicians = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const technicians = await prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: ['TECH', 'ADMIN', 'OWNER', 'SELLER'] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ technicians });
  } catch (error) {
    console.error('[repairs:getTechnicians]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/repairs
 * OWNER/ADMIN/SELLER: todas las órdenes de su sucursal activa.
 * TECH: las asignadas a sí mismo + el pool sin asignar (modelo pull).
 * Filtros: status, faultType (el técnico filtra por tipo de falla), search,
 * assignment ('mine' | 'unassigned'), technicianId (solo no-TECH).
 */
const getAll = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { status, technicianId, faultType, assignment, search, page = 1, limit = 50 } = req.query;

    // visibilityScope puede traer un `OR` (pool del TECH); search también usa
    // `OR` — se combinan con AND para que no se pisen entre sí.
    const scope = visibilityScope(role, userId);
    const searchClause = search
      ? {
          OR: [
            { customerName: { contains: search, mode: 'insensitive' } },
            { customerPhone: { contains: search, mode: 'insensitive' } },
            { deviceModel: { contains: search, mode: 'insensitive' } },
          ],
        }
      : null;

    const where = {
      tenantId,
      ...branchScope(req),
      ...(status && { status }),
      ...(faultType && { faultType }),
      ...(assignment === 'unassigned' && { technicianId: null }),
      ...(assignment === 'mine' && { technicianId: userId }),
      // Filtro por técnico ajeno: solo no-TECH, y solo si no pidió assignment.
      ...(technicianId && role !== 'TECH' && !assignment && { technicianId }),
      AND: [
        ...(Object.keys(scope).length ? [scope] : []),
        ...(searchClause ? [searchClause] : []),
      ],
    };

    const [repairs, total] = await prisma.$transaction([
      prisma.repairOrder.findMany({
        where,
        include: {
          technician: { select: { id: true, name: true } },
          tienda: TIENDA_SELECT,
          // Sólo el último comentario — alcanza para el badge "esperando
          // respuesta de: …" en la lista.
          comments: { orderBy: { createdAt: 'desc' }, take: 1, select: { fromTech: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.repairOrder.count({ where }),
    ]);

    // En la lista sólo interesa el badge derivado, no el comentario crudo.
    const rows = repairs.map((r) => {
      const { comments, ...rest } = serializeRepair(r);
      return rest;
    });

    res.json({ repairs: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('[repairs:getAll]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/repairs/:id
 * Incluye el historial completo de estados para el timeline.
 */
const getById = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { id } = req.params;

    const repair = await prisma.repairOrder.findFirst({
      where: { id, tenantId, ...visibilityScope(role, userId), ...branchScope(req) },
      include: REPAIR_DETAIL_INCLUDE,
    });

    if (!repair) return res.status(404).json({ message: 'Orden de reparación no encontrada.' });

    res.json(serializeRepair(repair));
  } catch (error) {
    console.error('[repairs:getById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/repairs
 * Modelo pull: la orden SIEMPRE arranca sin técnico asignado, sin importar el
 * rol de quien la carga. Un técnico la toma después con POST /repairs/:id/take.
 * (Un OWNER/ADMIN/SELLER puede asignar manualmente después vía PUT como
 * escape hatch, pero no al crear.)
 */
const createRepair = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const {
      customerName, customerPhone, deviceModel, deviceColor, deviceImei,
      faultType, faultDescription, budget, estimatedDate,
      internalNotes, customerId, tiendaId: bodyTiendaId,
    } = req.body;

    if (!customerName || !customerPhone || !deviceModel || !faultType || !faultDescription) {
      return res.status(400).json({
        message: 'Campos requeridos: nombre y teléfono del cliente, modelo, tipo de falla y descripción.',
      });
    }

    // Sucursal de origen del equipo:
    //   - OWNER/ADMIN/SELLER → SIEMPRE su sucursal activa (se ignora el body).
    //   - TECH → puede elegir cualquier sucursal del tenant (el equipo puede
    //     venir de cualquiera); si no elige, cae a su sucursal asignada.
    let tiendaId;
    if (role === 'TECH') {
      tiendaId = bodyTiendaId || req.user.tiendaId || null;
      if (!tiendaId) {
        return res.status(400).json({ message: 'Indicá de qué sucursal viene el equipo.' });
      }
      const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
      if (!tienda) {
        return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
      }
    } else {
      tiendaId = req.user.tiendaId;
    }

    const repair = await prisma.$transaction(async (tx) => {
      const created = await tx.repairOrder.create({
        data: {
          customerName,
          customerPhone,
          deviceModel,
          deviceColor: deviceColor || null,
          deviceImei: deviceImei || null,
          faultType,
          faultDescription,
          budget: budget ? parseFloat(budget) : null,
          estimatedDate: estimatedDate ? new Date(estimatedDate) : null,
          internalNotes: internalNotes || null,
          technicianId: null, // modelo pull — se toma después
          createdById: userId,
          customerId: customerId || null,
          tenantId,
          tiendaId,
        },
        include: {
          technician: { select: { id: true, name: true } },
          tienda: TIENDA_SELECT,
        },
      });

      // Entrada inicial en el historial
      await tx.repairStatusHistory.create({
        data: {
          status: 'RECEIVED',
          notes: 'Orden creada',
          repairId: created.id,
          changedById: userId,
        },
      });

      return created;
    });

    res.status(201).json(serializeRepair(repair));
  } catch (error) {
    console.error('[repairs:createRepair]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/repairs/:id
 * Si el status cambia a READY → setea readyAt.
 * Si cambia a DELIVERED → setea deliveredAt.
 * Cada cambio de status genera una entrada en RepairStatusHistory.
 */
const updateRepair = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { id } = req.params;
    const { status, budget, estimatedDate, internalNotes, technicianId, faultDescription, statusNote } = req.body;

    const existing = await prisma.repairOrder.findFirst({
      where: { id, tenantId, ...roleScope(role, userId), ...branchScope(req) },
    });

    if (!existing) return res.status(404).json({ message: 'Orden no encontrada.' });

    const statusChanged = status && status !== existing.status;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.repairOrder.update({
        where: { id },
        data: {
          ...(status && { status }),
          ...(statusChanged && status === 'READY' && { readyAt: new Date() }),
          ...(statusChanged && status === 'DELIVERED' && { deliveredAt: new Date() }),
          ...(budget !== undefined && { budget: budget ? parseFloat(budget) : null }),
          ...(estimatedDate !== undefined && { estimatedDate: estimatedDate ? new Date(estimatedDate) : null }),
          ...(internalNotes !== undefined && { internalNotes }),
          // Solo OWNER/ADMIN pueden reasignar técnico
          ...(technicianId !== undefined && role !== 'TECH' && { technicianId: technicianId || null }),
          ...(faultDescription && { faultDescription }),
        },
        include: REPAIR_DETAIL_INCLUDE,
      });

      if (statusChanged) {
        await tx.repairStatusHistory.create({
          data: {
            status,
            notes: statusNote || null,
            repairId: id,
            changedById: userId,
          },
        });
      }

      return result;
    });

    res.json(serializeRepair(updated));
  } catch (error) {
    console.error('[repairs:updateRepair]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/repairs/:id/take
 * Modelo pull: quien tenga acceso al módulo toma una orden SIN asignar. Atómico
 * ante concurrencia — mismo patrón que la venta de IMEI (pos.controller): el
 * UPDATE condicionado a `technicianId: null` toma el lock de fila en Postgres,
 * así que si dos técnicos la toman a la vez uno gana (count=1) y el otro
 * recibe 409, sin SELECT FOR UPDATE explícito.
 */
const takeRepair = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id } = req.params;

    const repair = await prisma.repairOrder.findFirst({
      where: { id, tenantId, ...branchScope(req) },
      select: { id: true, technicianId: true, status: true, createdById: true, customerName: true, deviceModel: true },
    });
    if (!repair) return res.status(404).json({ message: 'Orden no encontrada.' });
    if (repair.technicianId) {
      return res.status(409).json({ message: 'Esta orden ya fue tomada por otro técnico.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.repairOrder.updateMany({
        where: { id, technicianId: null },
        data: { technicianId: userId },
      });
      if (claim.count === 0) throw new RepairAlreadyTakenError();

      await tx.repairStatusHistory.create({
        data: { status: repair.status, notes: 'Tomó la orden', repairId: id, changedById: userId },
      });

      return tx.repairOrder.findUnique({ where: { id }, include: REPAIR_DETAIL_INCLUDE });
    });

    // Avisar al empleado que cargó la orden que ya la tomó un técnico.
    if (repair.createdById && repair.createdById !== userId) {
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await notify({
        tenantId,
        userIds: [repair.createdById],
        message: `${me?.name ?? 'Un técnico'} tomó la reparación de ${repair.customerName} (${repair.deviceModel}).`,
        type: 'INFO',
        link: `/repairs/${id}`,
      });
    }

    res.json(serializeRepair(updated));
  } catch (error) {
    if (error instanceof RepairAlreadyTakenError) {
      return res.status(409).json({ message: 'Esta orden ya fue tomada por otro técnico.' });
    }
    console.error('[repairs:takeRepair]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/repairs/:id/comments
 * Body: { body }
 * Agrega un comentario al thread de la orden. `fromTech` se congela con el rol
 * del autor en este momento. Notifica a la contraparte (empleado ↔ técnico).
 * Mismo scope de acceso que el resto del módulo (roleScope + branchScope): un
 * TECH sólo comenta órdenes asignadas a él.
 */
const addComment = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { id } = req.params;
    const { body } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ message: 'El comentario no puede estar vacío.' });
    }

    // visibilityScope: un TECH puede comentar también en el pool sin asignar
    // (ej. pedir una aclaración antes de tomarlo).
    const repair = await prisma.repairOrder.findFirst({
      where: { id, tenantId, ...visibilityScope(role, userId), ...branchScope(req) },
      select: { id: true, technicianId: true, createdById: true, customerName: true, deviceModel: true },
    });
    if (!repair) return res.status(404).json({ message: 'Orden no encontrada.' });

    const fromTech = role === 'TECH';

    const comment = await prisma.repairComment.create({
      data: { body: body.trim(), repairId: id, authorId: userId, fromTech },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    // Notificar a la otra parte del thread.
    const targetId = fromTech ? repair.createdById : repair.technicianId;
    if (targetId && targetId !== userId) {
      await notify({
        tenantId,
        userIds: [targetId],
        message: `${comment.author.name} comentó en la reparación de ${repair.customerName} (${repair.deviceModel}).`,
        type: 'INFO',
        link: `/repairs/${id}`,
      });
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error('[repairs:addComment]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * DELETE /api/repairs/:id
 * Solo OWNER. Hard delete — el cascade elimina el historial.
 */
const deleteRepair = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    // deleteRepair es authorize('OWNER','ADMIN','SELLER') — nunca TECH — así
    // que branchScope siempre acota a la sucursal activa.
    const existing = await prisma.repairOrder.findFirst({ where: { id, tenantId, ...branchScope(req) } });
    if (!existing) return res.status(404).json({ message: 'Orden no encontrada.' });

    await prisma.repairOrder.delete({ where: { id } });

    res.json({ message: 'Orden eliminada.' });
  } catch (error) {
    console.error('[repairs:deleteRepair]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { getStats, getTechnicians, getAll, getById, createRepair, updateRepair, takeRepair, addComment, deleteRepair };
