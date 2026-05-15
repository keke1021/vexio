const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const serializeDecimal = (val) => (val != null ? parseFloat(val) : null);

const serializeSession = (s) => ({
  ...s,
  initialAmountARS: serializeDecimal(s.initialAmountARS),
  initialAmountUSD: serializeDecimal(s.initialAmountUSD),
  finalAmount: serializeDecimal(s.finalAmount),
});

const serializeMovement = (m) => ({
  ...m,
  amount: serializeDecimal(m.amount),
});

const getOpenSession = (tenantId) =>
  prisma.cashSession.findFirst({
    where: { tenantId, closedAt: null },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
    },
  });

const getTodaySession = async (tenantId) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return prisma.cashSession.findFirst({
    where: { tenantId, openedAt: { gte: startOfDay } },
    include: {
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
    },
    orderBy: { openedAt: 'desc' },
  });
};

// ─── Open ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/cash/open
 * Solo puede haber una caja abierta por tenant.
 */
const openCash = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { initialAmountARS = 0, initialAmountUSD = 0, notes } = req.body;

    const existing = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
    });
    if (existing) {
      return res.status(409).json({ message: 'Ya hay una caja abierta.' });
    }

    const session = await prisma.cashSession.create({
      data: {
        initialAmountARS: parseFloat(initialAmountARS) || 0,
        initialAmountUSD: parseFloat(initialAmountUSD) || 0,
        notes: notes || null,
        openedById: userId,
        tenantId,
      },
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(serializeSession(session));
  } catch (error) {
    console.error('[cash:openCash]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Close ────────────────────────────────────────────────────────────────────

/**
 * POST /api/cash/close
 * Calcula el monto final a partir de movimientos y cierra la sesión.
 */
const closeCash = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { notes } = req.body;

    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
    });
    if (!session) {
      return res.status(404).json({ message: 'No hay una caja abierta.' });
    }

    const byType = await prisma.cashMovement.groupBy({
      by: ['type'],
      where: { sessionId: session.id },
      _sum: { amount: true },
    });

    const income  = parseFloat(byType.find((b) => b.type === 'INCOME')?._sum.amount  ?? 0);
    const expense = parseFloat(byType.find((b) => b.type === 'EXPENSE')?._sum.amount ?? 0);
    const finalAmount = parseFloat(session.initialAmountARS) + income - expense;

    const closed = await prisma.cashSession.update({
      where: { id: session.id },
      data: {
        closedAt: new Date(),
        finalAmount,
        closedById: userId,
        notes: notes || session.notes,
      },
      include: {
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
    });

    res.json(serializeSession(closed));
  } catch (error) {
    console.error('[cash:closeCash]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Current ──────────────────────────────────────────────────────────────────

/**
 * GET /api/cash/current
 * Retorna la sesión abierta, o la última del día si no hay ninguna abierta.
 */
const getCurrent = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const session = (await getOpenSession(tenantId)) ?? (await getTodaySession(tenantId));
    res.json({ session: session ? serializeSession(session) : null });
  } catch (error) {
    console.error('[cash:getCurrent]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Movements ────────────────────────────────────────────────────────────────

/**
 * POST /api/cash/movements
 * Registrar ingreso o egreso manual. Requiere caja abierta.
 */
const addMovement = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { type, amount, description, paymentMethod, currency, exchangeRate } = req.body;

    if (!['INCOME', 'EXPENSE'].includes(type)) {
      return res.status(400).json({ message: 'Tipo de movimiento inválido.' });
    }
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'El monto debe ser mayor a 0.' });
    }
    if (!description?.trim()) {
      return res.status(400).json({ message: 'La descripción es requerida.' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ message: 'El medio de pago es requerido.' });
    }

    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
    });
    if (!session) {
      return res.status(404).json({ message: 'No hay una caja abierta.' });
    }

    const movement = await prisma.cashMovement.create({
      data: {
        type,
        amount: parseFloat(amount),
        currency: ['ARS', 'USD', 'USDT'].includes(currency) ? currency : 'ARS',
        exchangeRate: exchangeRate ? parseFloat(exchangeRate) : null,
        description: description.trim(),
        paymentMethod,
        sessionId: session.id,
        createdById: userId,
        tenantId,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(serializeMovement(movement));
  } catch (error) {
    console.error('[cash:addMovement]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/cash/movements
 * Movimientos de la sesión actual (o la última del día si cerrada).
 */
const getMovements = async (req, res) => {
  try {
    const { tenantId } = req.user;

    const session =
      (await prisma.cashSession.findFirst({ where: { tenantId, closedAt: null } })) ??
      (await (async () => {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return prisma.cashSession.findFirst({
          where: { tenantId, openedAt: { gte: startOfDay } },
          orderBy: { openedAt: 'desc' },
        });
      })());

    if (!session) {
      return res.json({ movements: [], totals: { income: 0, expense: 0, balance: 0 } });
    }

    const movements = await prisma.cashMovement.findMany({
      where: { sessionId: session.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        sale: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const income  = movements.filter((m) => m.type === 'INCOME' ).reduce((s, m) => s + parseFloat(m.amount), 0);
    const expense = movements.filter((m) => m.type === 'EXPENSE').reduce((s, m) => s + parseFloat(m.amount), 0);

    res.json({
      movements: movements.map(serializeMovement),
      totals: {
        income,
        expense,
        balance: parseFloat(session.initialAmountARS) + income - expense,
      },
    });
  } catch (error) {
    console.error('[cash:getMovements]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * GET /api/cash/summary
 * Totales del día: ventas, ingresos manuales, egresos, saldo, por medio de pago.
 */
const getSummary = async (req, res) => {
  try {
    const { tenantId } = req.user;

    let session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
      include: { openedBy: { select: { id: true, name: true } }, closedBy: { select: { id: true, name: true } } },
    });

    if (!session) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      session = await prisma.cashSession.findFirst({
        where: { tenantId, openedAt: { gte: startOfDay } },
        include: { openedBy: { select: { id: true, name: true } }, closedBy: { select: { id: true, name: true } } },
        orderBy: { openedAt: 'desc' },
      });
    }

    if (!session) {
      return res.json({ isOpen: false, session: null, income: 0, expense: 0, salesTotal: 0, balance: 0, byPaymentMethod: {}, byCurrency: {} });
    }

    const [byType, byPayment, byCurrencyRaw, salesAgg] = await Promise.all([
      prisma.cashMovement.groupBy({
        by: ['type'],
        where: { sessionId: session.id },
        _sum: { amount: true },
      }),
      prisma.cashMovement.groupBy({
        by: ['paymentMethod', 'type'],
        where: { sessionId: session.id },
        _sum: { amount: true },
      }),
      prisma.cashMovement.groupBy({
        by: ['currency', 'type'],
        where: { sessionId: session.id },
        _sum: { amount: true },
      }),
      prisma.cashMovement.aggregate({
        where: { sessionId: session.id, type: 'INCOME', saleId: { not: null } },
        _sum: { amount: true },
      }),
    ]);

    const income     = parseFloat(byType.find((b) => b.type === 'INCOME')?._sum.amount  ?? 0);
    const expense    = parseFloat(byType.find((b) => b.type === 'EXPENSE')?._sum.amount ?? 0);
    const salesTotal = parseFloat(salesAgg._sum.amount ?? 0);

    const byPaymentMethod = {};
    for (const row of byPayment) {
      if (!byPaymentMethod[row.paymentMethod]) {
        byPaymentMethod[row.paymentMethod] = { income: 0, expense: 0 };
      }
      byPaymentMethod[row.paymentMethod][row.type === 'INCOME' ? 'income' : 'expense'] =
        parseFloat(row._sum.amount ?? 0);
    }

    const byCurrency = {};
    for (const row of byCurrencyRaw) {
      const cur = row.currency ?? 'ARS';
      if (!byCurrency[cur]) byCurrency[cur] = { income: 0, expense: 0 };
      byCurrency[cur][row.type === 'INCOME' ? 'income' : 'expense'] =
        parseFloat(row._sum.amount ?? 0);
    }

    res.json({
      isOpen: !session.closedAt,
      session: serializeSession(session),
      income,
      expense,
      salesTotal,
      balance: parseFloat(session.initialAmountARS) + income - expense,
      byPaymentMethod,
      byCurrency,
    });
  } catch (error) {
    console.error('[cash:getSummary]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { openCash, closeCash, getCurrent, addMovement, getMovements, getSummary };
