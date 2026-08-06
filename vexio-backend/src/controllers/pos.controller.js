const { PrismaClient } = require('@prisma/client');
const { getLiveRatesSafe, resolveRate, getOrCreateDailyRate } = require('../services/exchangeRates.service');
const { reduceLedgerByCurrency } = require('../utils/ledger');
const { findTenantTienda } = require('../utils/tienda');

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
    originalSalePrice: serializeDecimal(si.originalSalePrice),
    originalCostPrice: serializeDecimal(si.originalCostPrice),
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
 * Body: { items, paymentMethod, currency, tiendaId, customerName?, customerPhone?, notes? }
 * Toda venta pertenece a una sucursal — tiendaId es obligatorio y debe tener
 * una caja abierta (mismo criterio que cash.controller.js: una caja por
 * sucursal, no por tenant). En una sola transacción:
 * 1. Verifica que todos los items estén AVAILABLE
 * 2. Crea la Sale + SaleItems (con snapshot de moneda/precio original)
 * 3. Marca cada InventoryItem como SOLD
 * 4. Crea el CashMovement en la caja abierta de esa sucursal (documento,
 *    para el listado de movimientos)
 * 5. Crea el LedgerEntry (type=SALE) — el hecho financiero, fuente de
 *    verdad para cualquier balance
 *
 * La conversión de moneda la resuelve el backend con la cotización real
 * (dólar blue para USD, Binance para USDT) — no confía en un `exchangeRate`
 * mandado por el front. El front ya no manda ni `exchangeRate` ni
 * `exchangeType`: son ignorados si vienen.
 */
const createSale = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { items, paymentMethod, currency, customerName, customerPhone, notes, tiendaId } = req.body;

    if (!items?.length) {
      return res.status(400).json({ message: 'El carrito no puede estar vacío.' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ message: 'El medio de pago es requerido.' });
    }
    if (!Object.keys({ CASH: 1, TRANSFER: 1, CARD: 1, INSTALLMENTS: 1 }).includes(paymentMethod)) {
      return res.status(400).json({ message: 'Medio de pago inválido.' });
    }
    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal donde se realiza la venta.' });
    }

    // Toda venta pertenece a una sucursal (Sale.tiendaId es obligatorio en el
    // schema) — mismo criterio de validación de pertenencia que ya usa
    // cash.controller.js (findTenantTienda).
    const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const itemIds = items.map((i) => i.inventoryItemId);

    // La caja es por sucursal (igual que en cash.controller.js): no hay más
    // "la caja abierta del tenant", puede haber una sesión distinta abierta
    // por cada tienda al mismo tiempo. A diferencia del comportamiento
    // anterior, ahora es obligatoria — no se puede vender sin una caja
    // abierta en esa sucursal, porque el CashMovement/LedgerEntry de la
    // venta necesitan sessionId para poder ubicarse en la sucursal correcta.
    const openSession = await prisma.cashSession.findFirst({
      where: { tenantId, tiendaId, closedAt: null },
    });
    if (!openSession) {
      return res.status(409).json({
        message: `No hay una caja abierta en ${tienda.name} — abrí caja antes de vender.`,
      });
    }

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

    const validCurrencies = await prisma.currency.findMany({ where: { isActive: true }, select: { code: true } });
    const validCodes = new Set(validCurrencies.map((c) => c.code));
    const saleCurr = validCodes.has(currency) ? currency : 'ARS';

    // Solo se pide la cotización en vivo si hace falta convertir algo —
    // evita el fetch externo en la mayoría de las ventas (todo en la misma
    // moneda del stock).
    const needsConversion = inventoryItems.some((i) => i.currencyCode !== saleCurr);
    let liveRates = null;
    if (needsConversion) {
      try {
        liveRates = await getLiveRatesSafe();
      } catch (err) {
        return res.status(503).json({ message: 'No se pudo obtener la cotización para procesar la conversión.' });
      }
    }

    // Construir mapas de costo/precio/original por item desde la DB (nunca
    // desde lo que mande el frontend). `primaryPair` guarda la primera
    // conversión encontrada para el resumen a nivel Sale — si el carrito
    // mezcla más de un par de monedas distinto, cada item se convierte
    // igual de bien con su propia tasa, pero el campo único
    // Sale.exchangeRate solo puede describir un par (limitación heredada
    // del schema, ya existía antes de este cambio).
    const costMap = {};
    const priceMap = {};
    const originalMap = {};
    let primaryPair = null;

    for (const dbItem of inventoryItems) {
      const dbPrice = parseFloat(dbItem.salePrice);
      const dbCost  = parseFloat(dbItem.costPrice);
      const itemCur = dbItem.currencyCode;

      originalMap[dbItem.id] = { currencyCode: itemCur, salePrice: dbPrice, costPrice: dbCost };

      if (itemCur === saleCurr) {
        priceMap[dbItem.id] = dbPrice;
        costMap[dbItem.id]  = dbCost;
        continue;
      }

      const itemRate = resolveRate(liveRates, itemCur, saleCurr);
      if (!itemRate) {
        return res.status(422).json({
          message: `No se pudo obtener la cotización ${itemCur}/${saleCurr} para convertir el precio de uno de los equipos.`,
        });
      }
      // Bug preexistente encontrado de paso: costPrice nunca se convertía a
      // la moneda de venta (solo salePrice), así que SaleItem terminaba con
      // costPrice y salePrice en monedas distintas y el margen calculado en
      // serializeSale comparaba manzanas con naranjas. Se convierten los dos
      // con la misma tasa.
      priceMap[dbItem.id] = parseFloat((dbPrice * itemRate).toFixed(2));
      costMap[dbItem.id]  = parseFloat((dbCost * itemRate).toFixed(2));
      if (!primaryPair) primaryPair = { itemCur, saleCurr };
    }

    const total = parseFloat(Object.values(priceMap).reduce((sum, p) => sum + p, 0).toFixed(2));

    // Tasa "real aplicada" a nivel Sale/LedgerEntry, siempre expresada como
    // "1 <moneda no-ARS> = appliedRate ARS" — no importa la dirección de la
    // conversión, es el número que un humano reconoce (ej. "1 USDT = 1180
    // ARS"). También activa/actualiza la fila de referencia diaria en
    // ExchangeRate para ese par.
    let appliedRate = null;
    let appliedRateBase = null;
    let referenceRate = null;
    if (primaryPair) {
      appliedRateBase = primaryPair.itemCur === 'ARS' ? primaryPair.saleCurr : primaryPair.itemCur;
      appliedRate = resolveRate(liveRates, appliedRateBase, 'ARS');
      const source = appliedRateBase === 'USDT' ? 'binance' : 'bluelytics';
      referenceRate = await getOrCreateDailyRate(appliedRateBase, 'ARS', appliedRate, source);
    }

    const description = `Venta de ${itemIds.length} equipo${itemIds.length !== 1 ? 's' : ''}`;

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          total,
          paymentMethod,
          currencyCode: saleCurr,
          customerName:  customerName  || null,
          customerPhone: customerPhone || null,
          notes:         notes         || null,
          exchangeRate:    appliedRate,
          referenceRateId: referenceRate?.id ?? null,
          sellerId: userId,
          tenantId,
          tiendaId,
          items: {
            create: itemIds.map((id) => ({
              salePrice: priceMap[id],
              costPrice: costMap[id],
              originalCurrencyCode: originalMap[id].currencyCode,
              originalSalePrice:    originalMap[id].salePrice,
              originalCostPrice:    originalMap[id].costPrice,
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

      // Documento de caja — la caja abierta en esta sucursal es obligatoria
      // (se validó arriba), así que openSession siempre existe acá. No
      // genera su propio LedgerEntry: el hecho financiero de esta venta es
      // el ÚNICO LedgerEntry(type=SALE) de más abajo, para no contar la
      // misma plata dos veces (una como venta, otra como "movimiento de
      // caja").
      await tx.cashMovement.create({
        data: {
          type: 'INCOME',
          amount: total,
          currencyCode: saleCurr,
          exchangeRate: appliedRate,
          description,
          paymentMethod,
          sessionId: openSession.id,
          saleId: created.id,
          createdById: userId,
          tenantId,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          tenantId,
          currencyCode: saleCurr,
          amount: total,
          type: 'SALE',
          appliedRate,
          appliedRateBase,
          cashSessionId: openSession.id,
          saleId: created.id,
          description,
          createdById: userId,
        },
      });

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

    const [sales, total, ledgerRows, byCurrencyCount, byPaymentRaw] = await Promise.all([
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
      // summary.byCurrency sale del ledger, no de un aggregate propio —
      // misma reduceLedgerByCurrency que usa Caja/Reportes, no se reinventa
      // el cálculo acá.
      prisma.ledgerEntry.findMany({
        where: { type: 'SALE', sale: where },
        select: { currencyCode: true, amount: true, type: true },
      }),
      prisma.sale.groupBy({ by: ['currencyCode'], where, _count: { id: true } }),
      // byPaymentMethod desglosado también por moneda — antes sumaba
      // totales de ARS/USD/USDT juntos dentro de un mismo medio de pago.
      prisma.sale.groupBy({ by: ['paymentMethod', 'currencyCode'], where, _sum: { total: true }, _count: { id: true } }),
    ]);

    const breakdown = reduceLedgerByCurrency(
      ledgerRows.map((r) => ({ currencyCode: r.currencyCode, amount: parseFloat(r.amount), type: r.type }))
    );
    const countByCurrency = Object.fromEntries(byCurrencyCount.map((b) => [b.currencyCode, b._count.id]));

    const byCurrency = {};
    for (const code of new Set([...Object.keys(breakdown), ...Object.keys(countByCurrency)])) {
      byCurrency[code] = {
        total: breakdown[code]?.salesIncome ?? 0,
        count: countByCurrency[code] ?? 0,
      };
    }

    const byPaymentMethod = {};
    for (const row of byPaymentRaw) {
      if (!byPaymentMethod[row.paymentMethod]) byPaymentMethod[row.paymentMethod] = {};
      byPaymentMethod[row.paymentMethod][row.currencyCode] = {
        total: parseFloat(row._sum.total ?? 0),
        count: row._count.id,
      };
    }

    const summary = {
      salesCount: total,
      byCurrency,
      byPaymentMethod,
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
