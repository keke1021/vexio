const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier,
  createOrder, getOrders, updateOrder, addOrderPayment,
} = require('../controllers/suppliers.controller');

router.use(authenticate);

// Proveedores: OWNER / ADMIN / SELLER tienen acceso COMPLETO (no solo lectura)
// a todo el módulo — listado, detalle, historial de órdenes y pagos, alta,
// edición y baja de proveedores, órdenes de compra, señas y pagos/cobros.
// TECH no accede a nada de Proveedores.
const canUseSuppliers = authorize('OWNER', 'ADMIN', 'SELLER');

router.get('/suppliers',        canUseSuppliers, getSuppliers);
router.post('/suppliers',       canUseSuppliers, createSupplier);
router.get('/suppliers/:id',    canUseSuppliers, getSupplierById);
router.put('/suppliers/:id',    canUseSuppliers, updateSupplier);
router.delete('/suppliers/:id', canUseSuppliers, deleteSupplier);

router.get('/suppliers/:id/orders',          canUseSuppliers, getOrders);
router.post('/suppliers/:id/orders',         canUseSuppliers, createOrder);
router.put('/suppliers/:id/orders/:orderId', canUseSuppliers, updateOrder);

router.post('/suppliers/orders/:id/payments', canUseSuppliers, addOrderPayment);

module.exports = router;
