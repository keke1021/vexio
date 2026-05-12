const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const VALID_CATEGORIES = ['ERROR_SISTEMA', 'CONSULTA_GENERAL', 'PROBLEMA_MODULO', 'SUGERENCIA', 'FACTURACION'];
const VALID_PRIORITIES = ['BAJA', 'MEDIA', 'ALTA'];
const VALID_STATUSES   = ['ABIERTO', 'EN_PROCESO', 'RESUELTO'];

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * POST /api/tickets
 * Crea un ticket con hasta 3 archivos adjuntos (imágenes).
 */
const createTicket = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { title, description, category, priority } = req.body;

    if (!title || !description || !category) {
      return res.status(400).json({ message: 'title, description y category son requeridos.' });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: 'Categoría inválida.' });
    }

    const attachments = (req.files ?? []).map((f) => `/uploads/${f.filename}`);

    const ticket = await prisma.supportTicket.create({
      data: {
        title,
        description,
        category,
        priority: VALID_PRIORITIES.includes(priority) ? priority : 'MEDIA',
        attachments,
        tenantId,
        userId,
      },
      include: {
        user:   { select: { name: true } },
        tenant: { select: { name: true } },
      },
    });

    // Notificar al SUPERADMIN
    await prisma.notification.create({
      data: {
        message: `Nuevo ticket de "${ticket.tenant.name}": ${title}`,
        type:     'INFO',
        tenantId: null,
      },
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error('[tickets:create]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/tickets
 * SUPERADMIN → todos los tickets.
 * Tenant user → solo los de su tenant.
 */
const getTickets = async (req, res) => {
  try {
    const { tenantId, role } = req.user;
    const { status, category, priority } = req.query;

    const where = {
      ...(role !== 'SUPERADMIN' && { tenantId }),
      ...(status   && VALID_STATUSES.includes(status)     && { status }),
      ...(category && VALID_CATEGORIES.includes(category) && { category }),
      ...(priority && VALID_PRIORITIES.includes(priority) && { priority }),
    };

    const tickets = await prisma.supportTicket.findMany({
      where,
      include: {
        user:   { select: { name: true } },
        tenant: { select: { name: true, slug: true } },
        _count: { select: { replies: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ tickets });
  } catch (error) {
    console.error('[tickets:getAll]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Detail ───────────────────────────────────────────────────────────────────

/**
 * GET /api/tickets/:id
 */
const getTicketById = async (req, res) => {
  try {
    const { tenantId, role } = req.user;
    const { id } = req.params;

    const where = role === 'SUPERADMIN' ? { id } : { id, tenantId };

    const ticket = await prisma.supportTicket.findFirst({
      where,
      include: {
        user:   { select: { id: true, name: true, role: true } },
        tenant: { select: { name: true, slug: true } },
        replies: {
          include: { user: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado.' });

    res.json(ticket);
  } catch (error) {
    console.error('[tickets:getById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Reply ────────────────────────────────────────────────────────────────────

/**
 * POST /api/tickets/:id/reply
 * Responde un ticket. Funciona para cliente y SUPERADMIN.
 */
const addReply = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { id: ticketId } = req.params;
    const { message } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ message: 'El mensaje no puede estar vacío.' });
    }

    const where = role === 'SUPERADMIN' ? { id: ticketId } : { id: ticketId, tenantId };
    const ticket = await prisma.supportTicket.findFirst({ where });
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado.' });

    if (ticket.status === 'RESUELTO' && role !== 'SUPERADMIN') {
      return res.status(400).json({ message: 'No se puede responder un ticket resuelto.' });
    }

    const attachments = (req.files ?? []).map((f) => `/uploads/${f.filename}`);
    const isAdmin = role === 'SUPERADMIN';

    const reply = await prisma.ticketReply.create({
      data: { message, attachments, isAdmin, ticketId, userId },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    // Si el admin responde, cambiar a EN_PROCESO si estaba ABIERTO
    if (isAdmin && ticket.status === 'ABIERTO') {
      await prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'EN_PROCESO' },
      });
    }

    res.status(201).json(reply);
  } catch (error) {
    console.error('[tickets:addReply]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * PUT /api/tickets/:id/status
 * SUPERADMIN puede cambiar a cualquier estado.
 * OWNER/ADMIN puede cerrar (RESUELTO) su propio ticket.
 */
const updateStatus = async (req, res) => {
  try {
    const { tenantId, role } = req.user;
    const { id } = req.params;
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Estado inválido.' });
    }

    const where = role === 'SUPERADMIN' ? { id } : { id, tenantId };
    const ticket = await prisma.supportTicket.findFirst({ where });
    if (!ticket) return res.status(404).json({ message: 'Ticket no encontrado.' });

    if (role !== 'SUPERADMIN' && !['OWNER', 'ADMIN'].includes(role)) {
      return res.status(403).json({ message: 'Sin permiso para cambiar el estado.' });
    }
    if (role !== 'SUPERADMIN' && status !== 'RESUELTO') {
      return res.status(403).json({ message: 'Solo podés marcar el ticket como Resuelto.' });
    }

    const updated = await prisma.supportTicket.update({
      where: { id },
      data:  { status },
    });

    res.json(updated);
  } catch (error) {
    console.error('[tickets:updateStatus]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { createTicket, getTickets, getTicketById, addReply, updateStatus };
