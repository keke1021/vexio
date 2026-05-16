const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildDateFilter = (from, to) => {
  const filter = {};
  if (from) filter.gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    filter.lte = end;
  }
  return Object.keys(filter).length ? filter : undefined;
};

// ─── Sales ────────────────────────────────────────────────────────────────────

/**
 * GET /api/reports/sales?from=&to=
 * Total, ticket promedio, datos diarios para gráfico, desglose por medio de pago.
 */
const getSalesReport = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { from, to } = req.query;
    const dateFilter = buildDateFilter(from, to);
    const where = { tenantId, ...(dateFilter && { createdAt: dateFilter }) };

    const [agg, byPayment, byCurrencyRaw, allSales] = await Promise.all([
      prisma.sale.aggregate({ where, _sum: { total: true }, _count: { id: true } }),
      prisma.sale.groupBy({
        by: ['paymentMethod'],
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.sale.groupBy({
        by: ['currency'],
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.sale.findMany({
        where,
        select: { createdAt: true, total: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalAmount = parseFloat(agg._sum.total ?? 0);
    const salesCount  = agg._count.id;

    const dayMap = {};
    for (const s of allSales) {
      const day = s.createdAt.toISOString().split('T')[0];
      if (!dayMap[day]) dayMap[day] = { date: day, total: 0, count: 0 };
      dayMap[day].total  += parseFloat(s.total);
      dayMap[day].count  += 1;
    }
    for (const d of Object.values(dayMap)) {
      d.total = parseFloat(d.total.toFixed(2));
    }

    res.json({
      total:   totalAmount,
      count:   salesCount,
      avgTicket: salesCount > 0 ? parseFloat((totalAmount / salesCount).toFixed(2)) : 0,
      dailyData: Object.values(dayMap),
      byPaymentMethod: Object.fromEntries(
        byPayment.map((b) => [b.paymentMethod, {
          total: parseFloat(b._sum.total ?? 0),
          count: b._count.id,
        }])
      ),
      byCurrency: Object.fromEntries(
        byCurrencyRaw.map((b) => [(b.currency ?? 'ARS'), {
          total: parseFloat(b._sum.total ?? 0),
          count: b._count.id,
        }])
      ),
    });
  } catch (error) {
    console.error('[reports:sales]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Products ─────────────────────────────────────────────────────────────────

/**
 * GET /api/reports/products?from=&to=
 * Ranking de productos más vendidos con margen promedio.
 */
const getProductsReport = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { from, to } = req.query;
    const dateFilter = buildDateFilter(from, to);

    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: { tenantId, ...(dateFilter && { createdAt: dateFilter }) },
      },
      select: {
        salePrice: true,
        costPrice: true,
        inventoryItem: {
          select: {
            product: { select: { id: true, name: true, color: true, storage: true } },
          },
        },
      },
    });

    const map = {};
    for (const item of saleItems) {
      const p = item.inventoryItem?.product;
      if (!p) continue;
      const k = p.id;
      if (!map[k]) {
        map[k] = {
          productId: k,
          name: `${p.name} ${p.color} ${p.storage}`,
          soldCount: 0,
          revenue: 0,
          cost: 0,
        };
      }
      map[k].soldCount += 1;
      map[k].revenue   += parseFloat(item.salePrice);
      map[k].cost      += parseFloat(item.costPrice);
    }

    const topProducts = Object.values(map)
      .map((p) => ({
        productId:    p.productId,
        name:         p.name,
        soldCount:    p.soldCount,
        revenue:      parseFloat(p.revenue.toFixed(2)),
        avgMargin:    p.revenue > 0
          ? parseFloat(((p.revenue - p.cost) / p.revenue * 100).toFixed(1))
          : 0,
        avgSalePrice: p.soldCount > 0
          ? parseFloat((p.revenue / p.soldCount).toFixed(2))
          : 0,
      }))
      .sort((a, b) => b.soldCount - a.soldCount)
      .slice(0, 15);

    res.json({ topProducts, totalItems: saleItems.length });
  } catch (error) {
    console.error('[reports:products]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Inventory ────────────────────────────────────────────────────────────────

/**
 * GET /api/reports/inventory
 * Snapshot del stock actual: valor, cantidad por condición, alertas.
 */
const getInventoryReport = async (req, res) => {
  try {
    const { tenantId } = req.user;

    const [byCurrencyRaw, byCondition, products] = await Promise.all([
      prisma.inventoryItem.groupBy({
        by: ['currency'],
        where: { tenantId, status: 'AVAILABLE' },
        _sum: { costPrice: true, salePrice: true },
        _count: { id: true },
      }),
      prisma.inventoryItem.groupBy({
        by: ['condition'],
        where: { tenantId, status: 'AVAILABLE' },
        _count: { id: true },
        _sum: { costPrice: true, salePrice: true },
      }),
      prisma.product.findMany({
        where: { tenantId },
        include: {
          _count: { select: { items: { where: { status: 'AVAILABLE' } } } },
        },
      }),
    ]);

    const byCurrency = {};
    let totalItems = 0;
    for (const row of byCurrencyRaw) {
      byCurrency[row.currency] = {
        costValue: parseFloat(row._sum.costPrice ?? 0),
        saleValue: parseFloat(row._sum.salePrice ?? 0),
        count:     row._count.id,
      };
      totalItems += row._count.id;
    }

    const alerts = products
      .filter((p) => p._count.items <= p.minStock)
      .map((p) => ({
        product:   `${p.name} ${p.color} ${p.storage}`,
        available: p._count.items,
        minStock:  p.minStock,
        severity:  p._count.items === 0 ? 'out' : p._count.items === 1 ? 'last' : 'low',
      }))
      .sort((a, b) => a.available - b.available)
      .slice(0, 10);

    res.json({
      totalItems,
      byCurrency,
      byCondition: byCondition.map((c) => ({
        condition: c.condition,
        count:     c._count.id,
        costValue: parseFloat(c._sum.costPrice ?? 0),
        saleValue: parseFloat(c._sum.salePrice ?? 0),
      })),
      alerts,
    });
  } catch (error) {
    console.error('[reports:inventory]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Repairs ──────────────────────────────────────────────────────────────────

/**
 * GET /api/reports/repairs?from=&to=
 * Órdenes por estado, facturación, tiempo promedio en días.
 */
const getRepairsReport = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { from, to } = req.query;
    const dateFilter = buildDateFilter(from, to);
    const where = { tenantId, ...(dateFilter && { createdAt: dateFilter }) };

    const [byStatus, completed] = await Promise.all([
      prisma.repairOrder.groupBy({
        by: ['status'],
        where,
        _count: { id: true },
        _sum:   { budget: true },
      }),
      prisma.repairOrder.findMany({
        where: { ...where, status: 'DELIVERED', deliveredAt: { not: null } },
        select: { createdAt: true, deliveredAt: true },
      }),
    ]);

    const billingStatuses = ['READY', 'DELIVERED'];
    const totalBilling = byStatus
      .filter((b) => billingStatuses.includes(b.status))
      .reduce((s, b) => s + parseFloat(b._sum.budget ?? 0), 0);

    const avgRepairDays = completed.length > 0
      ? parseFloat((
          completed.reduce((sum, r) => sum + (r.deliveredAt - r.createdAt), 0)
          / completed.length
          / (1000 * 60 * 60 * 24)
        ).toFixed(1))
      : null;

    res.json({
      byStatus: Object.fromEntries(
        byStatus.map((b) => [b.status, {
          count: b._count.id,
          total: parseFloat(b._sum.budget ?? 0),
        }])
      ),
      totalBilling:   parseFloat(totalBilling.toFixed(2)),
      completedCount: completed.length,
      avgRepairDays,
    });
  } catch (error) {
    console.error('[reports:repairs]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Cash ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/reports/cash?from=&to=
 * Ingresos, egresos, saldo neto, desglose por medio de pago.
 */
const getCashReport = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { from, to } = req.query;
    const dateFilter = buildDateFilter(from, to);
    const where = { tenantId, ...(dateFilter && { createdAt: dateFilter }) };

    const [byType, byPayment] = await Promise.all([
      prisma.cashMovement.groupBy({
        by: ['type'],
        where,
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.cashMovement.groupBy({
        by: ['paymentMethod', 'type'],
        where,
        _sum: { amount: true },
      }),
    ]);

    const income  = parseFloat(byType.find((b) => b.type === 'INCOME')?._sum.amount  ?? 0);
    const expense = parseFloat(byType.find((b) => b.type === 'EXPENSE')?._sum.amount ?? 0);

    const byPaymentMethod = {};
    for (const row of byPayment) {
      if (!byPaymentMethod[row.paymentMethod]) {
        byPaymentMethod[row.paymentMethod] = { income: 0, expense: 0 };
      }
      byPaymentMethod[row.paymentMethod][row.type === 'INCOME' ? 'income' : 'expense'] =
        parseFloat(row._sum.amount ?? 0);
    }

    res.json({
      income,
      expense,
      netBalance: parseFloat((income - expense).toFixed(2)),
      byPaymentMethod,
    });
  } catch (error) {
    console.error('[reports:cash]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { getSalesReport, getProductsReport, getInventoryReport, getRepairsReport, getCashReport };
