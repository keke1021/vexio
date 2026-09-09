const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier,
  createOrder, getOrders, updateOrder, addOrderPayment,
} = require('../controllers/suppliers.controller');

router.use(authenticate);

// Proveedores: módulo de OWNER/ADMIN. TECH y SELLER no acceden a la gestión
// ni a las órdenes/pagos. Única excepción: el listado plano de proveedores
// (solo nombre/contacto) que consume el form de alta de inventario, del que
// SELLER sí participa.
router.get('/suppliers',     authorize('OWNER', 'ADMIN', 'SELLER'), getSuppliers);
router.post('/suppliers',    authorize('OWNER', 'ADMIN'), createSupplier);
router.get('/suppliers/:id', authorize('OWNER', 'ADMIN'), getSupplierById);
router.put('/suppliers/:id', authorize('OWNER', 'ADMIN'), updateSupplier);
router.delete('/suppliers/:id', authorize('OWNER'), deleteSupplier);

router.get('/suppliers/:id/orders',             authorize('OWNER', 'ADMIN'), getOrders);
router.post('/suppliers/:id/orders',            authorize('OWNER', 'ADMIN'), createOrder);
router.put('/suppliers/:id/orders/:orderId',    authorize('OWNER', 'ADMIN'), updateOrder);

router.post('/suppliers/orders/:id/payments', authorize('OWNER', 'ADMIN'), addOrderPayment);

module.exports = router;
