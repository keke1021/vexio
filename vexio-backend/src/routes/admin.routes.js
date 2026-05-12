const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getTenants, getTenantById, updateTenant,
  getStats, registerPayment, getPayments,
  createTenantUser, deleteTenantUser, getExpiringTenants,
  updateModules, addModuleAddon,
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
router.get('/tenants',          ...sa, getTenants);
router.get('/tenants/:id',      ...sa, getTenantById);
router.put('/tenants/:id',      ...sa, updateTenant);

// Payments
router.post('/tenants/:id/payment',    ...sa, registerPayment);
router.get('/tenants/:id/payments',    ...sa, getPayments);

// Users per tenant
router.post('/tenants/:id/users',            ...sa, createTenantUser);
router.delete('/tenants/:id/users/:userId',  ...sa, deleteTenantUser);

// Modules
router.put('/tenants/:id/modules',       ...sa, updateModules);
router.post('/tenants/:id/modules/addon',...sa, addModuleAddon);

// Tickets (admin view — all tenants)
router.get('/tickets',          ...sa, getTickets);
router.get('/tickets/:id',      ...sa, getTicketById);
router.post('/tickets/:id/reply',...sa, addReply);
router.put('/tickets/:id/status',...sa, updateStatus);

module.exports = router;
