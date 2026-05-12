const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier,
  createOrder, getOrders, updateOrder,
} = require('../controllers/suppliers.controller');

router.use(authenticate);

router.get('/suppliers',     getSuppliers);
router.post('/suppliers',    authorize('OWNER', 'ADMIN'), createSupplier);
router.get('/suppliers/:id', getSupplierById);
router.put('/suppliers/:id', authorize('OWNER', 'ADMIN'), updateSupplier);
router.delete('/suppliers/:id', authorize('OWNER'), deleteSupplier);

router.get('/suppliers/:id/orders',             getOrders);
router.post('/suppliers/:id/orders',            authorize('OWNER', 'ADMIN'), createOrder);
router.put('/suppliers/:id/orders/:orderId',    authorize('OWNER', 'ADMIN'), updateOrder);

module.exports = router;
