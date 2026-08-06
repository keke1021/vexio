const { PrismaClient } = require('@prisma/client');
const { reduceLedgerByCurrency, TENANT_BALANCE_EXCLUDED_TYPES } = require('../utils/ledger');

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
 * Cantidad de ventas, datos diarios para gráfico y desgloses — todo por
 * currencyCode. No hay un "total"/"avgTicket" único: sumar montos de ARS,
 * USD y USDT en un solo número es exactamente el bug que este módulo
 * reemplaza (ver diagnóstico). `count` es la única cifra que se muestra sin
 * desglosar por moneda porque es una cantidad de ventas, no un monto.
 *
 * NOTA: hasta que se actualice pos.controller.js (próximo módulo), la
 * creación de Sale falla en runtime porque el campo se renombró a
 * currencyCode — este reporte va a devolver todo en 0 mientras tanto. Es
 * esperado, no un bug de este endpoint.
 */
const getSalesReport = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { from, to } = req.query;
    const dateFilter = buildDateFilter(from, to);
    const where = { tenantId, ...(dateFilter && { createdAt: dateFilter }) };

    const [byPaymentRaw, byCurrencyRaw, allSales] = await Promise.all([
      prisma.sale.groupBy({
        by: ['paymentMethod', 'currencyCode'],
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.sale.groupBy({
        by: ['currencyCode'],
        where,
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.sale.findMany({
        where,
        select: { createdAt: true, total: true, currencyCode: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // dailyData: un objeto por día con un total por moneda (totals.ARS,
    // totals.USD, totals.USDT) — nunca se suman entre sí.
    const dayMap = {};
    for (const s of allSales) {
      const day = s.createdAt.toISOString().split('T')[0];
      if (!dayMap[day]) dayMap[day] = { date: day, totals: {}, counts: {} };
      const cur = s.currencyCode;
      dayMap[day].totals[cur] = (dayMap[day].totals[cur] ?? 0) + parseFloat(s.total);
      dayMap[day].counts[cur] = (dayMap[day].counts[cur] ?? 0) + 1;
    }
    for (const d of Object.values(dayMap)) {
      for (const cur of Object.keys(d.totals)) d.totals[cur] = parseFloat(d.totals[cur].toFixed(2));
    }

    const byPaymentMethod = {};
    for (const row of byPaymentRaw) {
      if (!byPaymentMethod[row.paymentMethod]) byPaymentMethod[row.paymentMethod] = {};
      byPaymentMethod[row.paymentMethod][row.currencyCode] = {
        total: parseFloat(row._sum.total ?? 0),
        count: row._count.id,
      };
    }

    const byCurrency = Object.fromEntries(
      byCurrencyRaw.map((b) => {
        const total = parseFloat(b._sum.total ?? 0);
        const count = b._count.id;
        return [b.currencyCode, {
          total,
          count,
          avgTicket: count > 0 ? parseFloat((total / count).toFixed(2)) : 0,
        }];
      })
    );

    res.json({
      count: allSales.length,
      dailyData: Object.values(dayMap),
      byPaymentMethod,
      byCurrency,
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
        by: ['currencyCode'],
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
      byCurrency[row.currencyCode] = {
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
 * Ingresos, egresos y saldo neto por moneda, calculados desde LedgerEntry —
 * antes este endpoint no separaba por moneda en absoluto (income/expense/
 * netBalance eran una mezcla de ARS+USD+USDT). Excluye
 * TENANT_BALANCE_EXCLUDED_TYPES (SUBSCRIPTION_PAYMENT: billing de Vexio, no
 * caja del tenant; PURCHASE_ORDER: deuda con el proveedor, no plata que
 * salió de la caja — ver regla en el schema).
 *
 * netBalance = income - expense + adjustments — a propósito NO incluye
 * openingBalance: un SESSION_OPEN que cae dentro del rango de fechas es
 * saldo transferido de una sesión a otra, no plata que "entró" ese día.
 * Se expone aparte en openingBalancesInPeriod para no perder el dato, pero
 * nunca se mezcla con income/netBalance. (Distinto del `balance` de sesión
 * en cash.controller.js, que sí incluye openingBalance a propósito — ahí
 * representa el efectivo real contra el que se concilia al cerrar caja.)
 */
const getCashReport = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { from, to } = req.query;
    const dateFilter = buildDateFilter(from, to);

    const [entries, byPaymentRaw] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where: {
          tenantId,
          type: { notIn: TENANT_BALANCE_EXCLUDED_TYPES },
          ...(dateFilter && { createdAt: dateFilter }),
        },
        select: { currencyCode: true, amount: true, type: true },
      }),
      prisma.cashMovement.groupBy({
        by: ['paymentMethod', 'type', 'currencyCode'],
        where: { tenantId, ...(dateFilter && { createdAt: dateFilter }) },
        _sum: { amount: true },
      }),
    ]);

    const breakdown = reduceLedgerByCurrency(
      entries.map((e) => ({ currencyCode: e.currencyCode, amount: parseFloat(e.amount), type: e.type }))
    );

    const byCurrency = Object.fromEntries(
      Object.entries(breakdown).map(([code, b]) => [code, {
        income: b.income,
        expense: b.expense,
        netBalance: parseFloat((b.income - b.expense + b.adjustments).toFixed(2)),
        openingBalancesInPeriod: b.openingBalance, // informativo — no forma parte de income ni de netBalance
      }])
    );

    const byPaymentMethod = {};
    for (const row of byPaymentRaw) {
      if (!byPaymentMethod[row.paymentMethod]) byPaymentMethod[row.paymentMethod] = {};
      if (!byPaymentMethod[row.paymentMethod][row.currencyCode]) {
        byPaymentMethod[row.paymentMethod][row.currencyCode] = { income: 0, expense: 0 };
      }
      byPaymentMethod[row.paymentMethod][row.currencyCode][row.type === 'INCOME' ? 'income' : 'expense'] =
        parseFloat(row._sum.amount ?? 0);
    }

    res.json({ byCurrency, byPaymentMethod });
  } catch (error) {
    console.error('[reports:cash]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { getSalesReport, getProductsReport, getInventoryReport, getRepairsReport, getCashReport };
