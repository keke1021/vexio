const { PrismaClient } = require('@prisma/client');
const { createTenantWithOwner } = require('../utils/tenantOnboarding');

const prisma = new PrismaClient();

const serializePayment = (p) => ({ ...p, amount: parseFloat(p.amount) });

// ─── Tenants ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/tenants
 * Alta manual de un tenant nuevo desde el panel de Admin — flujo separado
 * del registro público (POST /api/auth/register), solo accesible como
 * SUPERADMIN. Mismos campos que register más maxUsers (que register no
 * pide, es un campo solo de Admin). Usa el mismo helper que register para
 * crear Tenant + primer User (role OWNER, mismo hasheo de password) — no
 * se duplica esa lógica entre los dos flujos.
 *
 * A diferencia de register, acá NO se generan tokens ni se loguea a nadie
 * como el tenant nuevo — el SUPERADMIN sigue logueado como sí mismo. La
 * creación de la primera Tienda (sucursal) del tenant queda para un paso
 * aparte, desde el detalle del tenant.
 */
const createTenant = async (req, res) => {
  try {
    const { tenantName, tenantSlug, email, password, name, maxUsers } = req.body;

    if (!tenantName || !tenantSlug || !email || !password || !name) {
      return res.status(400).json({ message: 'tenantName, tenantSlug, email, password y name son requeridos.' });
    }

    const existingTenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (existingTenant) {
      return res.status(409).json({ message: 'El slug de tienda ya está en uso.' });
    }

    const extraTenantData = {};
    if (maxUsers !== undefined) {
      const n = parseInt(maxUsers, 10);
      if (isNaN(n) || n < 1) return res.status(400).json({ message: 'maxUsers debe ser un entero >= 1.' });
      extraTenantData.maxUsers = n;
    }

    const { tenant, user } = await createTenantWithOwner(prisma, {
      tenantName, tenantSlug, email, password, name, extraTenantData,
    });

    res.status(201).json({
      tenant,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    console.error('[admin:createTenant]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

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
            isActive: true, createdAt: true, tiendaId: true,
          },
          orderBy: { role: 'asc' },
        },
        tiendas: {
          orderBy: { name: 'asc' },
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
    const { status, plan, activeModules, extraUsers, maxUsers, subscriptionEndsAt, storeCount } = req.body;

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

    if (maxUsers !== undefined) {
      const n = parseInt(maxUsers, 10);
      if (isNaN(n) || n < 1) return res.status(400).json({ message: 'maxUsers debe ser un entero >= 1.' });
      data.maxUsers = n;
    }

    if (subscriptionEndsAt !== undefined) {
      data.subscriptionEndsAt = subscriptionEndsAt ? new Date(subscriptionEndsAt) : null;
    }

    if (storeCount !== undefined) {
      const n = parseInt(storeCount, 10);
      if (isNaN(n) || n < 1) return res.status(400).json({ message: 'storeCount debe ser un entero >= 1.' });
      data.storeCount = n; // informativo — no dispara ningún cálculo
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
    const [byStatus, totalItems, totalSales, totalRepairs, recentTenants] = await Promise.all([
      prisma.tenant.groupBy({ by: ['status'], _count: { id: true } }),
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

    res.json({
      totalTenants,
      activeTenants,
      byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count.id])),
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

const VALID_PAYMENT_TYPES = ['IMPLEMENTATION', 'MONTHLY'];

/**
 * POST /api/admin/tenants/:id/payment
 * Registrar pago manual de una tienda. El monto se carga a mano (no se
 * calcula desde el plan) — Payment.amount ya cubre eso, sin campo nuevo.
 *
 * Crea el Payment (documento) y su LedgerEntry (type=SUBSCRIPTION_PAYMENT,
 * paymentId) en la misma transacción — mismo patrón que Sale/CashMovement y
 * PurchaseOrder: el documento se ve en el historial de la tienda, el
 * LedgerEntry es el hecho financiero que alimenta el reporte de billing.
 */
const registerPayment = async (req, res) => {
  try {
    const { id: tenantId } = req.params;
    const { userId } = req.user;
    const { amount, currencyCode, paymentType, paidAt, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'El monto debe ser mayor a 0.' });
    }
    if (!VALID_PAYMENT_TYPES.includes(paymentType)) {
      return res.status(400).json({ message: 'paymentType inválido. Debe ser IMPLEMENTATION o MONTHLY.' });
    }

    const currency = await prisma.currency.findUnique({ where: { code: currencyCode } });
    if (!currency || !currency.isActive) {
      return res.status(400).json({ message: 'Moneda inválida.' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const parsedAmount = parseFloat(amount);
    const paidAtDate = paidAt ? new Date(paidAt) : new Date();
    const description = `Pago de suscripción — ${tenant.name} (${paymentType === 'IMPLEMENTATION' ? 'implementación' : 'mensualidad'})`;

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          amount:      parsedAmount,
          currencyCode: currency.code,
          paymentType,
          paidAt:      paidAtDate,
          notes:       notes || null,
          tenantId,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          tenantId,
          currencyCode: currency.code,
          amount: parsedAmount,
          type: 'SUBSCRIPTION_PAYMENT',
          paymentId: created.id,
          description,
          createdById: userId,
        },
      });

      return created;
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

    // Desglosado por moneda Y por paymentType — sumar implementación +
    // mensualidad en un solo número por moneda sería la misma familia de
    // bug que venimos corrigiendo en todo el proyecto (mezclar cosas
    // distintas en una sola suma), esta vez en la propia facturación.
    const totalByCurrency = {};
    for (const p of payments) {
      const cur = p.currencyCode;
      if (!totalByCurrency[cur]) totalByCurrency[cur] = { IMPLEMENTATION: 0, MONTHLY: 0 };
      totalByCurrency[cur][p.paymentType] += parseFloat(p.amount);
    }
    for (const cur of Object.keys(totalByCurrency)) {
      for (const type of VALID_PAYMENT_TYPES) {
        totalByCurrency[cur][type] = parseFloat(totalByCurrency[cur][type].toFixed(2));
      }
    }

    res.json({
      payments: payments.map(serializePayment),
      totalByCurrency,
    });
  } catch (error) {
    console.error('[admin:getPayments]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * GET /api/admin/billing-report?from=&to=
 * Ingreso real de Vexio (todos los tenants), desglosado por moneda y por
 * paymentType. Filtra por Payment.paidAt (cuándo se cobró realmente, no
 * cuándo se cargó el registro).
 *
 * ÚNICA vista de todo el sistema donde type=SUBSCRIPTION_PAYMENT debe
 * incluirse — ver regla en el schema (LedgerEntry) y TENANT_BALANCE_EXCLUDED_TYPES
 * en src/utils/ledger.js. En ningún reporte visible para el tenant (Caja,
 * Reportes, POS, Proveedores, Inventario) debe aparecer esta plata.
 */
const getBillingReport = async (req, res) => {
  try {
    const { from, to } = req.query;
    const paidAtFilter = {};
    if (from) paidAtFilter.gte = new Date(from);
    if (to) {
      const d = new Date(to);
      d.setDate(d.getDate() + 1);
      paidAtFilter.lte = d;
    }

    const entries = await prisma.ledgerEntry.findMany({
      where: {
        type: 'SUBSCRIPTION_PAYMENT',
        ...(Object.keys(paidAtFilter).length && { payment: { paidAt: paidAtFilter } }),
      },
      select: {
        currencyCode: true,
        amount: true,
        payment: { select: { paymentType: true, tenantId: true, tenant: { select: { name: true } } } },
      },
    });

    const byCurrency = {};
    for (const e of entries) {
      const cur = e.currencyCode;
      const type = e.payment?.paymentType ?? 'UNKNOWN';
      if (!byCurrency[cur]) byCurrency[cur] = { IMPLEMENTATION: 0, MONTHLY: 0 };
      byCurrency[cur][type] = (byCurrency[cur][type] ?? 0) + parseFloat(e.amount);
    }
    for (const cur of Object.keys(byCurrency)) {
      for (const type of Object.keys(byCurrency[cur])) {
        byCurrency[cur][type] = parseFloat(byCurrency[cur][type].toFixed(2));
      }
    }

    res.json({ count: entries.length, byCurrency });
  } catch (error) {
    console.error('[admin:getBillingReport]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

// ─── User management ─────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
// DEPRECATED — reemplazado por Tenant.maxUsers (límite real, seteado a mano
// por tenant). Se deja la constante comentada como referencia histórica del
// valor que tenía cada plan; ya no se usa en ningún lado.
// const PLAN_USER_LIMITS = { STARTER: 3, PRO: 5, FULL: 7 };

/**
 * POST /api/admin/tenants/:id/users
 * Crea un usuario para una tienda. Respeta Tenant.maxUsers + extraUsers.
 * Acepta tiendaId opcional (debe pertenecer al mismo tenant).
 */
const createTenantUser = async (req, res) => {
  try {
    const { id: tenantId } = req.params;
    const { name, email, password, role, tiendaId } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'name, email, password y role son requeridos.' });
    }
    if (!['OWNER', 'ADMIN', 'SELLER', 'TECH'].includes(role)) {
      return res.status(400).json({ message: 'Rol inválido.' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    if (tiendaId) {
      const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
      if (!tienda) return res.status(400).json({ message: 'La sucursal indicada no pertenece a esta tienda.' });
    }

    const activeCount = await prisma.user.count({ where: { tenantId, isActive: true } });
    const limit = (tenant.maxUsers ?? 7) + (tenant.extraUsers ?? 0);

    if (activeCount >= limit) {
      return res.status(403).json({
        message: `Esta tienda permite máximo ${limit} usuario${limit !== 1 ? 's' : ''}. Aumentá maxUsers o agregá usuarios extra.`,
      });
    }

    const existing = await prisma.user.findUnique({
      where: { email_tenantId: { email, tenantId } },
    });
    if (existing) return res.status(409).json({ message: 'Ya existe un usuario con ese email en esta tienda.' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role, tenantId, tiendaId: tiendaId || null },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, tiendaId: true },
    });

    res.status(201).json(user);
  } catch (error) {
    console.error('[admin:createTenantUser]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/admin/tenants/:id/users/:userId
 * Edita rol y/o sucursal (tiendaId) de un usuario existente.
 */
const updateTenantUser = async (req, res) => {
  try {
    const { id: tenantId, userId } = req.params;
    const { role, tiendaId } = req.body;

    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });

    const data = {};

    if (role !== undefined) {
      if (!['OWNER', 'ADMIN', 'SELLER', 'TECH'].includes(role)) {
        return res.status(400).json({ message: 'Rol inválido.' });
      }
      data.role = role;
    }

    if (tiendaId !== undefined) {
      if (tiendaId) {
        const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
        if (!tienda) return res.status(400).json({ message: 'La sucursal indicada no pertenece a esta tienda.' });
        data.tiendaId = tiendaId;
      } else {
        data.tiendaId = null;
      }
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ message: 'Nada que actualizar.' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, tiendaId: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('[admin:updateTenantUser]', error);
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

// ─── Sucursales (Tienda) ────────────────────────────────────────────────────
// Esqueleto administrativo — alta/baja/edición de sucursales de un tenant.
// No toca stock, caja ni ventas por sucursal (etapa futura separada).

/**
 * GET /api/admin/tenants/:id/tiendas
 * Lista las sucursales de un tenant.
 */
const getTiendas = async (req, res) => {
  try {
    const { id: tenantId } = req.params;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const tiendas = await prisma.tienda.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });

    res.json({ tiendas });
  } catch (error) {
    console.error('[admin:getTiendas]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * POST /api/admin/tenants/:id/tiendas
 * Crea una sucursal para un tenant.
 */
const createTienda = async (req, res) => {
  try {
    const { id: tenantId } = req.params;
    const { name, address } = req.body;

    if (!name) return res.status(400).json({ message: 'name es requerido.' });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ message: 'Tienda no encontrada.' });

    const existing = await prisma.tienda.findUnique({
      where: { name_tenantId: { name, tenantId } },
    });
    if (existing) return res.status(409).json({ message: 'Ya existe una sucursal con ese nombre en este tenant.' });

    const tienda = await prisma.tienda.create({
      data: { name, address: address || null, tenantId },
    });

    res.status(201).json(tienda);
  } catch (error) {
    console.error('[admin:createTienda]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/admin/tenants/:id/tiendas/:tiendaId
 * Edita nombre y/o dirección de una sucursal.
 */
const updateTienda = async (req, res) => {
  try {
    const { id: tenantId, tiendaId } = req.params;
    const { name, address } = req.body;

    const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
    if (!tienda) return res.status(404).json({ message: 'Sucursal no encontrada.' });

    const data = {};
    if (name !== undefined) {
      if (!name) return res.status(400).json({ message: 'name no puede estar vacío.' });
      data.name = name;
    }
    if (address !== undefined) data.address = address || null;

    if (!Object.keys(data).length) {
      return res.status(400).json({ message: 'Nada que actualizar.' });
    }

    const updated = await prisma.tienda.update({ where: { id: tiendaId }, data });
    res.json(updated);
  } catch (error) {
    console.error('[admin:updateTienda]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * DELETE /api/admin/tenants/:id/tiendas/:tiendaId
 * Elimina una sucursal. Los usuarios asignados quedan con tiendaId=null
 * (no se bloquea el borrado por eso — asignación es opcional/informativa).
 */
const deleteTienda = async (req, res) => {
  try {
    const { id: tenantId, tiendaId } = req.params;

    const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
    if (!tienda) return res.status(404).json({ message: 'Sucursal no encontrada.' });

    await prisma.$transaction([
      prisma.user.updateMany({ where: { tiendaId }, data: { tiendaId: null } }),
      prisma.tienda.delete({ where: { id: tiendaId } }),
    ]);

    res.json({ message: 'Sucursal eliminada exitosamente.' });
  } catch (error) {
    console.error('[admin:deleteTienda]', error);
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
  createTenant, getTenants, getTenantById, updateTenant, getStats, registerPayment, getPayments, getBillingReport,
  createTenantUser, updateTenantUser, deleteTenantUser, getExpiringTenants,
  updateModules, addModuleAddon,
  getTiendas, createTienda, updateTienda, deleteTienda,
};
