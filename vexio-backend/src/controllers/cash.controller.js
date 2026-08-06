const { PrismaClient } = require('@prisma/client');
const { reduceLedgerByCurrency, TENANT_BALANCE_EXCLUDED_TYPES } = require('../utils/ledger');
const { findTenantTienda } = require('../utils/tienda');

const prisma = new PrismaClient();

const serializeDecimal = (val) => (val != null ? parseFloat(val) : null);

const serializeSession = (s) => ({ ...s });

const serializeMovement = (m) => ({
  ...m,
  amount: serializeDecimal(m.amount),
});

const SESSION_INCLUDE = {
  openedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  tienda: { select: { id: true, name: true } },
};

// Una caja abierta por SUCURSAL, no por tenant — un tenant con 2+ tiendas
// tiene sesiones independientes en simultáneo. Por eso getOpenSession y
// getTodaySession piden tiendaId, no solo tenantId (antes asumían "la única
// caja del tenant").
const getOpenSession = (tenantId, tiendaId) =>
  prisma.cashSession.findFirst({
    where: { tenantId, tiendaId, closedAt: null },
    include: SESSION_INCLUDE,
  });

const getTodaySession = async (tenantId, tiendaId) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return prisma.cashSession.findFirst({
    where: { tenantId, tiendaId, openedAt: { gte: startOfDay } },
    include: SESSION_INCLUDE,
    orderBy: { openedAt: 'desc' },
  });
};

// Balance por moneda de una sesión, calculado siempre desde LedgerEntry —
// nunca desde una columna cacheada. Excluye SUBSCRIPTION_PAYMENT y
// PURCHASE_ORDER (TENANT_BALANCE_EXCLUDED_TYPES) — ninguno de los dos
// debería aparecer nunca con cashSessionId poblado, pero se filtra igual
// por consistencia con la regla del schema.
// balance = openingBalance + income - expense + adjustments (ver ledger.js) —
// acá sí queremos openingBalance incluido: es el balance real de la sesión,
// contra el que se concilia el efectivo contado al cerrar.
const getSessionBreakdown = async (sessionId) => {
  const rows = await prisma.ledgerEntry.findMany({
    where: {
      cashSessionId: sessionId,
      type: { notIn: TENANT_BALANCE_EXCLUDED_TYPES },
    },
    select: { currencyCode: true, amount: true, type: true },
  });
  return reduceLedgerByCurrency(rows.map((r) => ({ ...r, amount: parseFloat(r.amount) })));
};

const getActiveCurrencyCodes = async () => {
  const currencies = await prisma.currency.findMany({ where: { isActive: true }, select: { code: true } });
  return new Set(currencies.map((c) => c.code));
};

// ─── Open ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/cash/open
 * Body: { tiendaId, initialAmounts?: { [currencyCode]: number }, notes?: string }
 * tiendaId es obligatorio — CashSession.tiendaId lo exige el schema desde la
 * migración de Sucursales. Solo puede haber una caja abierta POR SUCURSAL,
 * no por tenant: un tenant con 2+ tiendas puede tener una sesión abierta en
 * cada una al mismo tiempo, son independientes entre sí.
 * Por cada moneda con monto inicial > 0 se crea un LedgerEntry
 * type=SESSION_OPEN — el saldo inicial ya no vive en columnas de CashSession.
 */
const openCash = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { initialAmounts = {}, notes, tiendaId } = req.body;

    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal donde se abre la caja.' });
    }
    const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const existing = await prisma.cashSession.findFirst({
      where: { tenantId, tiendaId, closedAt: null },
    });
    if (existing) {
      return res.status(409).json({ message: `Ya hay una caja abierta en ${tienda.name}.` });
    }

    const validCodes = await getActiveCurrencyCodes();
    const openingEntries = Object.entries(initialAmounts)
      .filter(([code]) => validCodes.has(code))
      .map(([code, amount]) => ({ code, amount: parseFloat(amount) || 0 }))
      .filter((e) => e.amount > 0);

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.cashSession.create({
        data: {
          notes: notes || null,
          openedById: userId,
          tenantId,
          tiendaId,
        },
      });

      if (openingEntries.length) {
        await tx.ledgerEntry.createMany({
          data: openingEntries.map((e) => ({
            tenantId,
            currencyCode: e.code,
            amount: e.amount,
            type: 'SESSION_OPEN',
            cashSessionId: created.id,
            description: `Apertura de caja — saldo inicial ${e.code}`,
            createdById: userId,
          })),
        });
      }

      return tx.cashSession.findUniqueOrThrow({
        where: { id: created.id },
        include: SESSION_INCLUDE,
      });
    });

    const byCurrency = await getSessionBreakdown(session.id);

    res.status(201).json({ ...serializeSession(session), byCurrency });
  } catch (error) {
    console.error('[cash:openCash]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Close ────────────────────────────────────────────────────────────────────

/**
 * POST /api/cash/close
 * Body: { tiendaId, notes?: string, countedAmounts?: { [currencyCode]: number } }
 * tiendaId es obligatorio — identifica CUÁL sesión abierta cerrar, ya que
 * puede haber una por sucursal simultáneamente (no hay una única "la caja
 * abierta del tenant" como antes).
 * El balance final por moneda se calcula desde LedgerEntry (nunca se pisa un
 * campo). Si el usuario informa un monto contado distinto al calculado para
 * alguna moneda, se registra la diferencia como un LedgerEntry nuevo
 * (type=SESSION_CLOSE_ADJUSTMENT) — el ajuste queda como hecho separado,
 * auditable, no como una corrección silenciosa del balance.
 */
const closeCash = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { notes, countedAmounts = {}, tiendaId } = req.body;

    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar qué sucursal se está cerrando.' });
    }
    const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const session = await prisma.cashSession.findFirst({
      where: { tenantId, tiendaId, closedAt: null },
    });
    if (!session) {
      return res.status(404).json({ message: `No hay una caja abierta en ${tienda.name}.` });
    }

    const calculatedBreakdown = await getSessionBreakdown(session.id);
    const calculatedBalances = Object.fromEntries(
      Object.entries(calculatedBreakdown).map(([code, b]) => [code, b.balance])
    );

    const validCodes = await getActiveCurrencyCodes();
    const adjustments = [];
    for (const [code, countedRaw] of Object.entries(countedAmounts)) {
      if (!validCodes.has(code)) continue;
      const counted = parseFloat(countedRaw);
      if (Number.isNaN(counted)) continue;
      const calculated = calculatedBalances[code] ?? 0;
      const diff = parseFloat((counted - calculated).toFixed(2));
      if (diff !== 0) {
        adjustments.push({
          tenantId,
          currencyCode: code,
          amount: diff,
          type: 'SESSION_CLOSE_ADJUSTMENT',
          cashSessionId: session.id,
          description: `Ajuste de cierre ${code}: contado ${counted} vs calculado ${calculated}`,
          createdById: userId,
        });
      }
    }

    const closed = await prisma.$transaction(async (tx) => {
      if (adjustments.length) {
        await tx.ledgerEntry.createMany({ data: adjustments });
      }
      return tx.cashSession.update({
        where: { id: session.id },
        data: {
          closedAt: new Date(),
          closedById: userId,
          notes: notes ?? session.notes,
        },
        include: SESSION_INCLUDE,
      });
    });

    const finalBreakdown = await getSessionBreakdown(session.id);

    res.json({
      session: serializeSession(closed),
      calculatedBalances,
      countedAmounts,
      adjustments: adjustments.map(({ currencyCode, amount, description }) => ({ currencyCode, amount, description })),
      byCurrency: finalBreakdown,
    });
  } catch (error) {
    console.error('[cash:closeCash]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Current ──────────────────────────────────────────────────────────────────

/**
 * GET /api/cash/current?tiendaId=
 * Retorna la sesión abierta de esa sucursal, o la última del día si no hay
 * ninguna abierta. tiendaId es obligatorio — cada sucursal tiene su propia
 * sesión, no existe más "la sesión actual del tenant" a secas.
 */
const getCurrent = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { tiendaId } = req.query;

    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal.' });
    }
    const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const session = (await getOpenSession(tenantId, tiendaId)) ?? (await getTodaySession(tenantId, tiendaId));
    if (!session) return res.json({ session: null, byCurrency: {} });
    const byCurrency = await getSessionBreakdown(session.id);
    res.json({ session: serializeSession(session), byCurrency });
  } catch (error) {
    console.error('[cash:getCurrent]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Movements ────────────────────────────────────────────────────────────────

/**
 * POST /api/cash/movements
 * Body: { tiendaId, type, amount, description, paymentMethod, currencyCode?, exchangeRate?, appliedRateBase? }
 * Registrar ingreso o egreso manual. Requiere caja abierta EN ESA SUCURSAL —
 * tiendaId es obligatorio para saber a cuál de las (posiblemente varias)
 * sesiones abiertas del tenant se le agrega el movimiento. El CashMovement
 * en sí no tiene columna tiendaId propia (el schema no la agregó) — hereda
 * la sucursal implícitamente vía session.tiendaId, a través de sessionId.
 */
const addMovement = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { type, amount, description, paymentMethod, currencyCode, exchangeRate, appliedRateBase, tiendaId } = req.body;

    if (!['INCOME', 'EXPENSE'].includes(type)) {
      return res.status(400).json({ message: 'Tipo de movimiento inválido.' });
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ message: 'El monto debe ser mayor a 0.' });
    }
    if (!description?.trim()) {
      return res.status(400).json({ message: 'La descripción es requerida.' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ message: 'El medio de pago es requerido.' });
    }
    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal.' });
    }

    const currency = await prisma.currency.findUnique({ where: { code: currencyCode || 'ARS' } });
    if (!currency || !currency.isActive) {
      return res.status(400).json({ message: 'Moneda inválida.' });
    }

    const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const session = await prisma.cashSession.findFirst({
      where: { tenantId, tiendaId, closedAt: null },
    });
    if (!session) {
      return res.status(404).json({ message: `No hay una caja abierta en ${tienda.name}.` });
    }

    const rate = exchangeRate ? parseFloat(exchangeRate) : null;
    const trimmedDescription = description.trim();

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.cashMovement.create({
        data: {
          type,
          amount: parsedAmount,
          currencyCode: currency.code,
          exchangeRate: rate,
          description: trimmedDescription,
          paymentMethod,
          sessionId: session.id,
          createdById: userId,
          tenantId,
        },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          tenantId,
          currencyCode: currency.code,
          amount: type === 'INCOME' ? parsedAmount : -parsedAmount,
          type: type === 'INCOME' ? 'CASH_MOVEMENT_INCOME' : 'CASH_MOVEMENT_EXPENSE',
          appliedRate: rate,
          appliedRateBase: rate ? (appliedRateBase || 'ARS') : null,
          cashSessionId: session.id,
          cashMovementId: created.id,
          description: trimmedDescription,
          createdById: userId,
        },
      });

      return created;
    });

    res.status(201).json(serializeMovement(movement));
  } catch (error) {
    console.error('[cash:addMovement]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/cash/movements?tiendaId=
 * Movimientos de la sesión actual de esa sucursal (o la última del día si
 * cerrada), más el balance por moneda calculado desde LedgerEntry.
 * tiendaId obligatorio, mismo motivo que en el resto del módulo.
 */
const getMovements = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { tiendaId } = req.query;

    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal.' });
    }
    const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    const session =
      (await prisma.cashSession.findFirst({ where: { tenantId, tiendaId, closedAt: null } })) ??
      (await getTodaySession(tenantId, tiendaId));

    if (!session) {
      return res.json({ movements: [], byCurrency: {} });
    }

    const [movements, byCurrency] = await Promise.all([
      prisma.cashMovement.findMany({
        where: { sessionId: session.id },
        include: {
          createdBy: { select: { id: true, name: true } },
          sale: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      getSessionBreakdown(session.id),
    ]);

    res.json({
      movements: movements.map(serializeMovement),
      byCurrency,
    });
  } catch (error) {
    console.error('[cash:getMovements]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Historial de sesiones ──────────────────────────────────────────────────────

/**
 * GET /api/cash/sessions?tiendaId=&page=&pageSize=
 * Historial de CashSession del tenant (abiertas y cerradas), más recientes
 * primero. tiendaId es OPCIONAL acá — a diferencia del resto del módulo,
 * esta es una pantalla de consulta que puede ver todas las sucursales a la
 * vez si no se filtra ninguna en particular. Paginado con el mismo patrón
 * page/pageSize que inventory.controller.js (default 1/50).
 * Cada sesión trae su balance final por moneda (calculado desde
 * LedgerEntry, mismo criterio que getSessionBreakdown) y sus ajustes de
 * cierre, si tuvo.
 */
const getSessions = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { tiendaId, page = 1, pageSize = 50 } = req.query;

    if (tiendaId) {
      const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
      if (!tienda) {
        return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
      }
    }

    const where = { tenantId, ...(tiendaId && { tiendaId }) };
    const pageNum     = Math.max(parseInt(page) || 1, 1);
    const pageSizeNum = Math.max(parseInt(pageSize) || 50, 1);

    const [sessions, total] = await prisma.$transaction([
      prisma.cashSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: { openedAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.cashSession.count({ where }),
    ]);

    // Balance final por moneda + ajustes de cierre de TODAS las sesiones de
    // esta página en dos queries (no una por sesión) — mismos LedgerEntry
    // que usa getSessionBreakdown, solo agrupados acá por cashSessionId.
    const sessionIds = sessions.map((s) => s.id);

    const balanceRows = sessionIds.length
      ? await prisma.ledgerEntry.findMany({
          where: { cashSessionId: { in: sessionIds }, type: { notIn: TENANT_BALANCE_EXCLUDED_TYPES } },
          select: { cashSessionId: true, currencyCode: true, amount: true, type: true },
        })
      : [];
    const balanceRowsBySession = {};
    for (const r of balanceRows) {
      (balanceRowsBySession[r.cashSessionId] ??= []).push({
        currencyCode: r.currencyCode, amount: parseFloat(r.amount), type: r.type,
      });
    }

    const adjustmentRows = sessionIds.length
      ? await prisma.ledgerEntry.findMany({
          where: { cashSessionId: { in: sessionIds }, type: 'SESSION_CLOSE_ADJUSTMENT' },
          select: { cashSessionId: true, currencyCode: true, amount: true, description: true },
        })
      : [];
    const adjustmentsBySession = {};
    for (const a of adjustmentRows) {
      (adjustmentsBySession[a.cashSessionId] ??= []).push({
        currencyCode: a.currencyCode, amount: serializeDecimal(a.amount), description: a.description,
      });
    }

    const result = sessions.map((s) => ({
      ...serializeSession(s),
      isOpen: !s.closedAt,
      byCurrency: reduceLedgerByCurrency(balanceRowsBySession[s.id] ?? []),
      adjustments: adjustmentsBySession[s.id] ?? [],
    }));

    res.json({
      sessions: result,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.max(Math.ceil(total / pageSizeNum), 1),
    });
  } catch (error) {
    console.error('[cash:getSessions]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/cash/sessions/:id
 * Detalle completo de una sesión puntual (abierta o cerrada) — todos sus
 * movimientos, para poder auditar qué pasó en ese turno específico. Mismo
 * shape que GET /cash/movements, pero sobre un id explícito en vez de
 * asumir "la sesión actual de la sucursal".
 */
const getSessionById = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { id } = req.params;

    const session = await prisma.cashSession.findFirst({
      where: { id, tenantId },
      include: SESSION_INCLUDE,
    });
    if (!session) return res.status(404).json({ message: 'Sesión de caja no encontrada.' });

    const [movements, byCurrency, adjustmentRows] = await Promise.all([
      prisma.cashMovement.findMany({
        where: { sessionId: session.id },
        include: {
          createdBy: { select: { id: true, name: true } },
          sale: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      getSessionBreakdown(session.id),
      prisma.ledgerEntry.findMany({
        where: { cashSessionId: session.id, type: 'SESSION_CLOSE_ADJUSTMENT' },
        select: { currencyCode: true, amount: true, description: true },
      }),
    ]);

    res.json({
      session: { ...serializeSession(session), isOpen: !session.closedAt },
      movements: movements.map(serializeMovement),
      byCurrency,
      adjustments: adjustmentRows.map((a) => ({ ...a, amount: serializeDecimal(a.amount) })),
    });
  } catch (error) {
    console.error('[cash:getSessionById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * GET /api/cash/summary?tiendaId=
 * Balance por moneda de la sesión actual de esa sucursal (o la última del
 * día), desglose por medio de pago y moneda. Nunca devuelve un número único
 * mezclando monedas. tiendaId obligatorio, mismo motivo que en el resto del
 * módulo — cada sucursal tiene su propio resumen, no se mezclan entre sí.
 */
const getSummary = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const { tiendaId } = req.query;

    if (!tiendaId) {
      return res.status(400).json({ message: 'Falta indicar la sucursal.' });
    }
    const tienda = await findTenantTienda(prisma, tenantId, tiendaId);
    if (!tienda) {
      return res.status(400).json({ message: 'La sucursal indicada no pertenece a tu tienda.' });
    }

    let session = await prisma.cashSession.findFirst({
      where: { tenantId, tiendaId, closedAt: null },
      include: SESSION_INCLUDE,
    });

    if (!session) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      session = await prisma.cashSession.findFirst({
        where: { tenantId, tiendaId, openedAt: { gte: startOfDay } },
        include: SESSION_INCLUDE,
        orderBy: { openedAt: 'desc' },
      });
    }

    if (!session) {
      return res.json({ isOpen: false, session: null, byCurrency: {}, byPaymentMethod: {} });
    }

    const [byCurrency, byPaymentRaw] = await Promise.all([
      getSessionBreakdown(session.id),
      prisma.cashMovement.groupBy({
        by: ['paymentMethod', 'type', 'currencyCode'],
        where: { sessionId: session.id },
        _sum: { amount: true },
      }),
    ]);

    // byPaymentMethod desglosado también por moneda — un medio de pago puede
    // tener movimientos en más de una moneda dentro de la misma sesión.
    const byPaymentMethod = {};
    for (const row of byPaymentRaw) {
      if (!byPaymentMethod[row.paymentMethod]) byPaymentMethod[row.paymentMethod] = {};
      if (!byPaymentMethod[row.paymentMethod][row.currencyCode]) {
        byPaymentMethod[row.paymentMethod][row.currencyCode] = { income: 0, expense: 0 };
      }
      byPaymentMethod[row.paymentMethod][row.currencyCode][row.type === 'INCOME' ? 'income' : 'expense'] =
        parseFloat(row._sum.amount ?? 0);
    }

    res.json({
      isOpen: !session.closedAt,
      session: serializeSession(session),
      byCurrency,
      byPaymentMethod,
    });
  } catch (error) {
    console.error('[cash:getSummary]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  openCash, closeCash, getCurrent, addMovement, getMovements, getSummary,
  getSessions, getSessionById,
};
