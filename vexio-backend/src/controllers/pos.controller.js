const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_LABELS = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  INSTALLMENTS: 'Cuotas',
};

const serializeDecimal = (val) => (val != null ? parseFloat(val) : null);

const serializeSale = (sale) => ({
  ...sale,
  total: serializeDecimal(sale.total),
  items: sale.items?.map((si) => ({
    ...si,
    salePrice: serializeDecimal(si.salePrice),
    costPrice: serializeDecimal(si.costPrice),
    margin: si.salePrice > 0
      ? parseFloat((((si.salePrice - si.costPrice) / si.salePrice) * 100).toFixed(2))
      : 0,
    inventoryItem: si.inventoryItem
      ? {
          ...si.inventoryItem,
          costPrice: serializeDecimal(si.inventoryItem.costPrice),
          salePrice: serializeDecimal(si.inventoryItem.salePrice),
        }
      : undefined,
  })),
});

const serializeInventoryItem = (item) => ({
  ...item,
  costPrice: serializeDecimal(item.costPrice),
  salePrice: serializeDecimal(item.salePrice),
  margin: item.salePrice > 0
    ? parseFloat((((item.salePrice - item.costPrice) / item.salePrice) * 100).toFixed(2))
    : 0,
});

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * GET /api/pos/search-item?q=...
 * Busca equipos DISPONIBLES por IMEI o nombre de modelo.
 * Optimizado para lectura desde lector de código de barras (IMEI exacto).
 */
const searchItem = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { q } = req.query;

    if (!q || q.trim().length < 2) return res.json({ items: [] });

    const items = await prisma.inventoryItem.findMany({
      where: {
        tenantId,
        status: 'AVAILABLE',
        OR: [
          { imei: { contains: q.trim(), mode: 'insensitive' } },
          { product: { name: { contains: q.trim(), mode: 'insensitive' } } },
          { product: { color: { contains: q.trim(), mode: 'insensitive' } } },
        ],
      },
      include: {
        product: true,
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    res.json({ items: items.map(serializeInventoryItem) });
  } catch (error) {
    console.error('[pos:searchItem]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Sales ────────────────────────────────────────────────────────────────────

/**
 * POST /api/pos/sales
 * Crea una venta. En una sola transacción:
 * 1. Verifica que todos los items estén AVAILABLE
 * 2. Crea la Sale + SaleItems
 * 3. Marca cada InventoryItem como SOLD
 */
const createSale = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { items, paymentMethod, currency, customerName, customerPhone, notes, exchangeRate, exchangeType } = req.body;

    if (!items?.length) {
      return res.status(400).json({ message: 'El carrito no puede estar vacío.' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ message: 'El medio de pago es requerido.' });
    }
    if (!Object.keys({ CASH: 1, TRANSFER: 1, CARD: 1, INSTALLMENTS: 1 }).includes(paymentMethod)) {
      return res.status(400).json({ message: 'Medio de pago inválido.' });
    }

    const itemIds = items.map((i) => i.inventoryItemId);

    // Buscar caja abierta para registrar el movimiento (no bloquea la venta si no hay)
    const openSession = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
    });

    // Verificar que todos los items existen y pertenecen al tenant
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, tenantId },
      include: { product: true },
    });

    if (inventoryItems.length !== itemIds.length) {
      return res.status(400).json({ message: 'Uno o más equipos no fueron encontrados.' });
    }

    // Ninguno puede estar SOLD o DEFECTIVE
    const nonAvailable = inventoryItems.filter((i) => i.status !== 'AVAILABLE');
    if (nonAvailable.length > 0) {
      const imeis = nonAvailable.map((i) => i.imei).join(', ');
      return res.status(409).json({
        message: `Los siguientes equipos no están disponibles: ${imeis}`,
      });
    }

    // Construir mapas de costo y precio por item desde la DB (no confiar en el frontend)
    const saleCurr = ['ARS', 'USD', 'USDT'].includes(currency) ? currency : 'ARS';
    const rate     = exchangeRate ? parseFloat(exchangeRate) : null;

    const needsConversion = inventoryItems.some((i) => (i.currency ?? 'ARS') !== saleCurr);
    if (needsConversion && !rate) {
      return res.status(400).json({ message: 'Se requiere tipo de cambio para convertir entre monedas.' });
    }

    const costMap  = {};
    const priceMap = {};
    for (const dbItem of inventoryItems) {
      const dbPrice = parseFloat(dbItem.salePrice);
      const itemCur = dbItem.currency ?? 'ARS';
      costMap[dbItem.id] = parseFloat(dbItem.costPrice);

      if (itemCur === saleCurr) {
        priceMap[dbItem.id] = dbPrice;
      } else if (itemCur !== 'ARS' && saleCurr === 'ARS') {
        // USD/USDT → ARS: multiplicar por TC
        priceMap[dbItem.id] = rate ? Math.round(dbPrice * rate) : dbPrice;
      } else if (itemCur === 'ARS' && saleCurr !== 'ARS') {
        // ARS → USD/USDT: dividir por TC
        priceMap[dbItem.id] = rate ? +(dbPrice / rate).toFixed(2) : dbPrice;
      } else {
        priceMap[dbItem.id] = dbPrice; // USD ↔ USDT (1:1)
      }
    }

    const total = Object.values(priceMap).reduce((sum, p) => sum + p, 0);

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          total,
          paymentMethod,
          currency: saleCurr,
          customerName:  customerName  || null,
          customerPhone: customerPhone || null,
          notes:         notes         || null,
          exchangeRate:  rate,
          exchangeType:  exchangeType && ['BLUE', 'USDT', 'NONE'].includes(exchangeType) ? exchangeType : null,
          sellerId: userId,
          tenantId,
          items: {
            create: itemIds.map((id) => ({
              salePrice:       priceMap[id],
              costPrice:       costMap[id],
              inventoryItemId: id,
            })),
          },
        },
        include: {
          seller: { select: { id: true, name: true, role: true } },
          items: {
            include: {
              inventoryItem: { include: { product: true } },
            },
          },
        },
      });

      // Marcar todos los items como SOLD
      await tx.inventoryItem.updateMany({
        where: { id: { in: itemIds } },
        data: { status: 'SOLD' },
      });

      // Registrar movimiento de caja si hay sesión abierta
      if (openSession) {
        await tx.cashMovement.create({
          data: {
            type: 'INCOME',
            amount: total,
            currency: saleCurr,
            exchangeRate: rate,
            description: `Venta de ${itemIds.length} equipo${itemIds.length !== 1 ? 's' : ''}`,
            paymentMethod,
            sessionId: openSession.id,
            saleId: created.id,
            createdById: userId,
            tenantId,
          },
        });
      }

      return created;
    });

    res.status(201).json(serializeSale(sale));
  } catch (error) {
    console.error('[pos:createSale]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/pos/sales
 * OWNER/ADMIN → todas las ventas del tenant.
 * SELLER/TECH → solo las propias.
 * Filtros: from, to (fechas), paymentMethod.
 */
const getSales = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { from, to, paymentMethod, page = 1, limit = 50 } = req.query;

    // Scope por rol
    const roleFilter = ['SELLER', 'TECH'].includes(role) ? { sellerId: userId } : {};

    // Rango de fechas: el "to" incluye el día completo
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      dateFilter.lte = toDate;
    }

    const where = {
      tenantId,
      ...roleFilter,
      ...(paymentMethod && { paymentMethod }),
      ...((from || to) && { createdAt: dateFilter }),
    };

    const [sales, total, aggregate, byPayment] = await prisma.$transaction([
      prisma.sale.findMany({
        where,
        include: {
          seller: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.sale.count({ where }),
      prisma.sale.aggregate({ where, _sum: { total: true }, _count: { id: true } }),
      prisma.sale.groupBy({
        by: ['paymentMethod'],
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const summary = {
      salesCount: aggregate._count.id,
      totalAmount: serializeDecimal(aggregate._sum.total) ?? 0,
      byPaymentMethod: Object.fromEntries(
        byPayment.map((b) => [
          b.paymentMethod,
          { total: serializeDecimal(b._sum.total) ?? 0, count: b._count.id },
        ])
      ),
    };

    res.json({
      sales: sales.map((s) => ({ ...s, total: serializeDecimal(s.total) })),
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      summary,
    });
  } catch (error) {
    console.error('[pos:getSales]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/pos/sales/:id
 */
const getSaleById = async (req, res) => {
  try {
    const { tenantId, userId, role } = req.user;
    const { id } = req.params;

    const sale = await prisma.sale.findFirst({
      where: { id, tenantId },
      include: {
        seller: { select: { id: true, name: true, role: true } },
        items: {
          include: {
            inventoryItem: { include: { product: true } },
          },
        },
      },
    });

    if (!sale) return res.status(404).json({ message: 'Venta no encontrada.' });

    // SELLER/TECH solo pueden ver sus propias ventas
    if (['SELLER', 'TECH'].includes(role) && sale.sellerId !== userId) {
      return res.status(403).json({ message: 'No tenés permiso para ver esta venta.' });
    }

    res.json(serializeSale(sale));
  } catch (error) {
    console.error('[pos:getSaleById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { searchItem, createSale, getSales, getSaleById };
