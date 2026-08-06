const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  createTenant, getTenants, getTenantById, updateTenant,
  getStats, registerPayment, getPayments, getBillingReport,
  createTenantUser, updateTenantUser, deleteTenantUser, getExpiringTenants,
  updateModules, addModuleAddon,
  getTiendas, createTienda, updateTienda, deleteTienda,
} = require('../controllers/admin.controller');
const { getTickets, getTicketById, addReply, updateStatus } = require('../controllers/tickets.controller');

const sa = [authenticate, authorize('SUPERADMIN')];

// Diagnostic — verifica auth sin tocar Prisma
router.get('/ping', ...sa, (req, res) => {
  res.json({ ok: true, role: req.user?.role, userId: req.user?.userId });
});

// Stats
router.get('/stats',            ...sa, getStats);

// Expiring — must be before /:id
router.get('/tenants/expiring', ...sa, getExpiringTenants);

// Tenants
router.post('/tenants',         ...sa, createTenant);
router.get('/tenants',          ...sa, getTenants);
router.get('/tenants/:id',      ...sa, getTenantById);
router.put('/tenants/:id',      ...sa, updateTenant);

// Payments
router.post('/tenants/:id/payment',    ...sa, registerPayment);
router.get('/tenants/:id/payments',    ...sa, getPayments);

// Billing report — único lugar del sistema donde se muestra
// SUBSCRIPTION_PAYMENT (ingreso real de Vexio, no caja del tenant)
router.get('/billing-report',          ...sa, getBillingReport);

// Users per tenant
router.post('/tenants/:id/users',            ...sa, createTenantUser);
router.put('/tenants/:id/users/:userId',     ...sa, updateTenantUser);
router.delete('/tenants/:id/users/:userId',  ...sa, deleteTenantUser);

// Sucursales (Tienda) per tenant
router.get('/tenants/:id/tiendas',              ...sa, getTiendas);
router.post('/tenants/:id/tiendas',             ...sa, createTienda);
router.put('/tenants/:id/tiendas/:tiendaId',    ...sa, updateTienda);
router.delete('/tenants/:id/tiendas/:tiendaId', ...sa, deleteTienda);

// Modules
router.put('/tenants/:id/modules',       ...sa, updateModules);
router.post('/tenants/:id/modules/addon',...sa, addModuleAddon);

// Tickets (admin view — all tenants)
router.get('/tickets',          ...sa, getTickets);
router.get('/tickets/:id',      ...sa, getTicketById);
router.post('/tickets/:id/reply',...sa, addReply);
router.put('/tickets/:id/status',...sa, updateStatus);

module.exports = router;
