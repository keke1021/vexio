const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// USD/month por plan — referencia interna para calcular MRR estimado
const PLAN_MRR = { STARTER: 19, PRO: 39, FULL: 69 };

const serializePayment = (p) => ({ ...p, amount: parseFloat(p.amount) });

// ─── Tenants ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tenants
 * Lista todas las tiendas con contadores de actividad.
 */
const getTenants = async (req, res) => {
  try {
    console.log('[admin:getTenants] iniciando — user:', req.user?.role, req.user?.userId);

    const tenants = await prisma.tenant.findMany({
      select: {
        id: true, name: true, slug: true, email: true,
        isActive: true, status: true, plan: true,
        subscriptionEndsAt: true,
        createdAt: true, updatedAt: true,
        _count: {
          select: {
            users: true,
            inventoryItems: true,
            sales: true,
            repairOrders: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log('[admin:getTenants] encontrados:', tenants.length);
    res.json({ tenants });
  } catch (error) {
    console.error('[admin:getTenants] ERROR:', error.message, '\n', error.stack);
    res.status(500).json({ message: 'Error interno del servidor.', detail: error.message });
  }
};

/**
 * GET /api/admin/tenants/:id
 * Detalle completo de una tienda con usuarios.
 */
const getTenantById = async (req, res) => {
  try {
    const { id } = req.params;

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true, name: true, email: true, role: true,
            isActive: true, createdAt: true,
          },
          orderBy: { role: 'asc' },
        },
        _count: {
          select: {
            users: true,
            inventoryItems: { where: { status: 'AVAILABLE' } },
            sales: true,
            repairOrders: true,
            purchaseOrders: true,
          },
        },
      },
    });

    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    res.json(tenant);
  } catch (error) {
    console.error('[admin:getTenantById]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/admin/tenants/:id
 * Activar, suspender, cambiar plan, extraUsers, subscriptionEndsAt.
 */
const updateTenant = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, plan, activeModules, extraUsers, subscriptionEndsAt } = req.body;

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const data = {};

    if (status) {
      if (!['ACTIVE', 'SUSPENDED', 'TRIAL'].includes(status)) {
        return res.status(400).json({ message: 'Estado inválido.' });
      }
      data.status   = status;
      data.isActive = status === 'ACTIVE' || status === 'TRIAL';
    }

    if (plan) {
      if (!['STARTER', 'PRO', 'FULL'].includes(plan)) {
        return res.status(400).json({ message: 'Plan inválido.' });
      }
      data.plan = plan;
      // Caller may override which modules are active; otherwise default to plan's set
      data.activeModules = Array.isArray(activeModules) ? activeModules : PLAN_MODULES[plan];
    }

    if (extraUsers !== undefined) {
      const n = parseInt(extraUsers, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ message: 'extraUsers debe ser un entero >= 0.' });
      data.extraUsers = n;
    }

    if (subscriptionEndsAt !== undefined) {
      data.subscriptionEndsAt = subscriptionEndsAt ? new Date(subscriptionEndsAt) : null;
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ message: 'Nada que actualizar.' });
    }

    const tenant = await prisma.tenant.update({ where: { id }, data });
    res.json(tenant);
  } catch (error) {
    console.error('[admin:updateTenant]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/stats
 * Métricas globales del SaaS.
 */
const getStats = async (req, res) => {
  try {
    const [byStatus, byPlan, totalItems, totalSales, totalRepairs, recentTenants] = await Promise.all([
      prisma.tenant.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.tenant.groupBy({ by: ['plan', 'status'], _count: { id: true } }),
      prisma.inventoryItem.count({ where: { status: 'AVAILABLE' } }),
      prisma.sale.count(),
      prisma.repairOrder.count(),
      prisma.tenant.findMany({
        select: { id: true, name: true, plan: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const totalTenants  = byStatus.reduce((s, b) => s + b._count.id, 0);
    const activeTenants = byStatus.find((b) => b.status === 'ACTIVE')?._count.id ?? 0;

    const mrr = byPlan
      .filter((b) => b.status === 'ACTIVE')
      .reduce((sum, b) => sum + (PLAN_MRR[b.plan] ?? 0) * b._count.id, 0);

    const byPlanTotals = Object.fromEntries(
      ['STARTER', 'PRO', 'FULL'].map((plan) => [
        plan,
        byPlan.filter((b) => b.plan === plan).reduce((s, b) => s + b._count.id, 0),
      ])
    );

    res.json({
      totalTenants,
      activeTenants,
      mrr,
      mrrCurrency: 'USD',
      byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count.id])),
      byPlan: byPlanTotals,
      totalItems,
      totalSales,
      totalRepairs,
      recentTenants,
    });
  } catch (error) {
    console.error('[admin:getStats]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/tenants/:id/payment
 * Registrar pago manual de una tienda.
 */
const registerPayment = async (req, res) => {
  try {
    const { id: tenantId } = req.params;
    const { amount, currency, paidAt, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'El monto debe ser mayor a 0.' });
    }
    if (!['USD', 'PESOS', 'USDT'].includes(currency)) {
      return res.status(400).json({ message: 'Moneda inválida.' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const payment = await prisma.payment.create({
      data: {
        amount:   parseFloat(amount),
        currency,
        paidAt:   paidAt ? new Date(paidAt) : new Date(),
        notes:    notes || null,
        tenantId,
      },
    });

    res.status(201).json(serializePayment(payment));
  } catch (error) {
    console.error('[admin:registerPayment]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/admin/tenants/:id/payments
 * Historial de pagos de una tienda.
 */
const getPayments = async (req, res) => {
  try {
    const { id: tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const payments = await prisma.payment.findMany({
      where: { tenantId },
      orderBy: { paidAt: 'desc' },
    });

    const totalByCurrency = payments.reduce((acc, p) => {
      const k = p.currency;
      acc[k] = (acc[k] ?? 0) + parseFloat(p.amount);
      return acc;
    }, {});

    res.json({
      payments: payments.map(serializePayment),
      totalByCurrency,
    });
  } catch (error) {
    console.error('[admin:getPayments]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── User management ─────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const PLAN_USER_LIMITS = { STARTER: 3, PRO: 5, FULL: 7 };

/**
 * POST /api/admin/tenants/:id/users
 * Crea un usuario para una tienda. Respeta el límite del plan + extraUsers.
 */
const createTenantUser = async (req, res) => {
  try {
    const { id: tenantId } = req.params;
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'name, email, password y role son requeridos.' });
    }
    if (!['OWNER', 'ADMIN', 'SELLER', 'TECH'].includes(role)) {
      return res.status(400).json({ message: 'Rol inválido.' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const activeCount = await prisma.user.count({ where: { tenantId, isActive: true } });
    const limit = (PLAN_USER_LIMITS[tenant.plan] ?? 3) + (tenant.extraUsers ?? 0);

    if (activeCount >= limit) {
      return res.status(403).json({
        message: `El plan ${tenant.plan} permite máximo ${limit} usuario${limit !== 1 ? 's' : ''}. Aumentá el plan o agregá usuarios extra.`,
      });
    }

    const existing = await prisma.user.findUnique({
      where: { email_tenantId: { email, tenantId } },
    });
    if (existing) return res.status(409).json({ message: 'Ya existe un usuario con ese email en esta tienda.' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role, tenantId },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });

    res.status(201).json(user);
  } catch (error) {
    console.error('[admin:createTenantUser]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * DELETE /api/admin/tenants/:id/users/:userId
 * Desactiva un usuario de una tienda. No permite eliminar el último OWNER.
 */
const deleteTenantUser = async (req, res) => {
  try {
    const { id: tenantId, userId } = req.params;

    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });

    if (user.role === 'OWNER') {
      const ownerCount = await prisma.user.count({ where: { tenantId, role: 'OWNER', isActive: true } });
      if (ownerCount <= 1) {
        return res.status(400).json({ message: 'No se puede eliminar el único OWNER de la tienda.' });
      }
    }

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    res.json({ message: 'Usuario desactivado exitosamente.' });
  } catch (error) {
    console.error('[admin:deleteTenantUser]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Modules ──────────────────────────────────────────────────────────────────

const PLAN_MODULES = {
  STARTER: ['inventory', 'pos', 'customers'],
  PRO:     ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties'],
  FULL:    ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties', 'whatsapp', 'reports', 'multibranch'],
};

const ADDON_PRICES = {
  repairs: 40, cash: 40, suppliers: 40, warranties: 30,
  whatsapp: 50, reports: 60, multibranch: 70,
};

/**
 * PUT /api/admin/tenants/:id/modules
 * Reemplaza el array activeModules de una tienda.
 */
const updateModules = async (req, res) => {
  try {
    const { id } = req.params;
    const { activeModules } = req.body;

    if (!Array.isArray(activeModules)) {
      return res.status(400).json({ message: 'activeModules debe ser un array.' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const updated = await prisma.tenant.update({ where: { id }, data: { activeModules } });
    res.json({ activeModules: updated.activeModules });
  } catch (error) {
    console.error('[admin:updateModules]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/admin/tenants/:id/modules/addon
 * Agrega un módulo como add-on a una tienda.
 */
const addModuleAddon = async (req, res) => {
  try {
    const { id } = req.params;
    const { module } = req.body;

    if (!module) return res.status(400).json({ message: 'module es requerido.' });

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const current = tenant.activeModules ?? [];
    if (current.includes(module)) {
      return res.json({ activeModules: current });
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: { activeModules: [...current, module] },
    });

    res.json({ activeModules: updated.activeModules, addonPrice: ADDON_PRICES[module] ?? null });
  } catch (error) {
    console.error('[admin:addModuleAddon]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── Expiring tenants ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/tenants/expiring
 * Tiendas que vencen en los próximos 7 días. Crea notificaciones para SUPERADMIN.
 */
const getExpiringTenants = async (req, res) => {
  try {
    const now = new Date();
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const tenants = await prisma.tenant.findMany({
      where: { subscriptionEndsAt: { gte: now, lte: sevenDays }, isActive: true },
      select: { id: true, name: true, slug: true, plan: true, status: true, subscriptionEndsAt: true },
      orderBy: { subscriptionEndsAt: 'asc' },
    });

    // Crear notificaciones para SUPERADMIN si no existe una reciente
    for (const t of tenants) {
      const exists = await prisma.notification.findFirst({
        where: { tenantId: null, message: { contains: t.name }, createdAt: { gte: oneDayAgo } },
      });
      if (!exists) {
        const daysLeft = Math.ceil((new Date(t.subscriptionEndsAt) - now) / 86400000);
        await prisma.notification.create({
          data: {
            message: `La suscripción de "${t.name}" vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`,
            type: daysLeft <= 2 ? 'DANGER' : 'WARNING',
            tenantId: null,
          },
        });
      }
    }

    res.json({ tenants });
  } catch (error) {
    console.error('[admin:getExpiringTenants]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = {
  getTenants, getTenantById, updateTenant, getStats, registerPayment, getPayments,
  createTenantUser, deleteTenantUser, getExpiringTenants,
  updateModules, addModuleAddon,
};
