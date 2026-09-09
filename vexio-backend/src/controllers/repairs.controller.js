const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const serializeRepair = (repair) => ({
  ...repair,
  budget: repair.budget != null ? parseFloat(repair.budget) : null,
});

// ── Dos dimensiones de scope, independientes entre sí ──────────────────────
// ROL (quién): TECH solo ve/edita sus propias órdenes asignadas.
const roleScope = (role, userId) =>
  role === 'TECH' ? { technicianId: userId } : {};

// SUCURSAL (de dónde es el equipo): OWNER/ADMIN/SELLER ven solo las órdenes de
// su sucursal activa. TECH es la EXCEPCIÓN EXPLÍCITA: ve las de TODAS las
// sucursales combinadas (el taller es uno solo y recibe equipos de todas), sin
// elegir ninguna — cada orden igual expone su tiendaId de origen.
const branchScope = (req) =>
  req.user.role === 'TECH' || req.user.role === 'SUPERADMIN'
    ? {}
    : { tiendaId: req.user.tiendaId };

const TIENDA_SELECT = { select: { id: true, name: true } };

// ─── Stats (usada por el badge del Layout) ────────────────────────────────────

/**
 * GET /api/repairs/stats
 * Retorna conteos ligeros para el badge de la navegación.
 */
const getStats = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const scope = { ...roleScope(role, userId), ...branchScope(req) };

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
 * OWNER/ADMIN: todas las órdenes del tenant.
 * TECH: solo las asignadas a sí mismo.
 */
const getAll = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { status, technicianId, search, page = 1, limit = 50 } = req.query;

    const where = {
      tenantId,
      ...roleScope(role, userId),
      ...branchScope(req),
      ...(status && { status }),
      // Solo OWNER/ADMIN pueden filtrar por técnico ajeno
      ...(technicianId && role !== 'TECH' && { technicianId }),
      ...(search && {
        OR: [
          { customerName: { contains: search, mode: 'insensitive' } },
          { customerPhone: { contains: search, mode: 'insensitive' } },
          { deviceModel: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [repairs, total] = await prisma.$transaction([
      prisma.repairOrder.findMany({
        where,
        include: {
          technician: { select: { id: true, name: true } },
          tienda: TIENDA_SELECT,
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.repairOrder.count({ where }),
    ]);

    res.json({ repairs: repairs.map(serializeRepair), total, page: parseInt(page), limit: parseInt(limit) });
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
      where: { id, tenantId, ...roleScope(role, userId), ...branchScope(req) },
      include: {
        technician: { select: { id: true, name: true, role: true } },
        tienda: TIENDA_SELECT,
        customer: true,
        statusHistory: {
          include: { changedBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
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
 * TECH que crea una orden sin asignar técnico → se auto-asigna.
 */
const createRepair = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const {
      customerName, customerPhone, deviceModel, deviceColor, deviceImei,
      faultType, faultDescription, technicianId, budget, estimatedDate,
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

    // TECH sin técnico asignado → se asigna a sí mismo
    const assignedTechId = role === 'TECH' && !technicianId ? userId : (technicianId || null);

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
          technicianId: assignedTechId,
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
        include: {
          technician: { select: { id: true, name: true, role: true } },
          tienda: TIENDA_SELECT,
          customer: true,
          statusHistory: {
            include: { changedBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
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

module.exports = { getStats, getTechnicians, getAll, getById, createRepair, updateRepair, deleteRepair };
