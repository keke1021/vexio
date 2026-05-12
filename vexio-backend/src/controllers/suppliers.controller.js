const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const serializeDecimal = (val) => (val != null ? parseFloat(val) : null);

const serializeOrder = (o) => ({
  ...o,
  total: serializeDecimal(o.total),
  items: o.items?.map((i) => ({ ...i, unitPrice: serializeDecimal(i.unitPrice) })),
});

const withDebt = (s) => ({
  ...s,
  totalDebt: (s.purchaseOrders ?? []).reduce((sum, o) => sum + parseFloat(o.total), 0),
  purchaseOrders: undefined,
});

// ─── Suppliers CRUD ───────────────────────────────────────────────────────────

/**
 * GET /api/suppliers
 * Lista activos con deuda total calculada (sum de órdenes PENDING).
 */
const getSuppliers = async (req, res) => {
  try {
    const { tenantId } = req.user;

    const suppliers = await prisma.supplier.findMany({
      where: { tenantId, isActive: true },
      include: {
        purchaseOrders: {
          where: { status: 'PENDING' },
          select: { total: true },
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
 * Detalle del proveedor con stats de compras.
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

    const [pendingAgg, receivedAgg, byStatus] = await Promise.all([
      prisma.purchaseOrder.aggregate({
        where: { supplierId: id, tenantId, status: 'PENDING' },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: { supplierId: id, tenantId, status: 'RECEIVED' },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.purchaseOrder.groupBy({
        by: ['status'],
        where: { supplierId: id, tenantId },
        _count: { id: true },
      }),
    ]);

    res.json({
      ...supplier,
      stats: {
        totalDebt:     serializeDecimal(pendingAgg._sum.total) ?? 0,
        pendingOrders: pendingAgg._count.id,
        totalReceived: serializeDecimal(receivedAgg._sum.total) ?? 0,
        receivedOrders: receivedAgg._count.id,
        ordersByStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count.id])),
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
 * Crea una orden de compra con sus líneas de detalle.
 */
const createOrder = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id: supplierId } = req.params;
    const { items, notes, currency } = req.body;

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

    const total = items.reduce((sum, i) => sum + parseInt(i.quantity) * parseFloat(i.unitPrice), 0);

    const order = await prisma.purchaseOrder.create({
      data: {
        total,
        currency: ['ARS', 'USD', 'USDT'].includes(currency) ? currency : 'ARS',
        notes: notes || null,
        supplierId,
        tenantId,
        items: {
          create: items.map((i) => ({
            description: i.description.trim(),
            quantity: parseInt(i.quantity),
            unitPrice: parseFloat(i.unitPrice),
          })),
        },
      },
      include: { items: true },
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
        items: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const pendingTotal = orders
      .filter((o) => o.status === 'PENDING')
      .reduce((s, o) => s + parseFloat(o.total), 0);

    res.json({ orders: orders.map(serializeOrder), pendingTotal });
  } catch (error) {
    console.error('[suppliers:getOrders]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/suppliers/:id/orders/:orderId
 * Marca la orden como RECEIVED o CANCELLED.
 */
const updateOrder = async (req, res) => {
  try {
    const { tenantId } = req.user;
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

    const updated = await prisma.purchaseOrder.update({
      where: { id: orderId },
      data: {
        status,
        receivedAt: status === 'RECEIVED' ? new Date() : null,
        ...(notes !== undefined && { notes: notes || order.notes }),
      },
      include: { items: true },
    });

    res.json(serializeOrder(updated));
  } catch (error) {
    console.error('[suppliers:updateOrder]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier,
  createOrder, getOrders, updateOrder,
};
