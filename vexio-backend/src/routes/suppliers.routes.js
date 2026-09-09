const express = require('express');
const router = express.Router();
const { authenticate, authorize, requireActiveTienda } = require('../middlewares/auth.middleware');
const {
  getSuppliers, getSupplierById, createSupplier, updateSupplier, deleteSupplier,
  createOrder, getOrders, updateOrder, addOrderPayment,
} = require('../controllers/suppliers.controller');

router.use(authenticate);

// Proveedores: OWNER / ADMIN / SELLER tienen acceso COMPLETO. TECH no accede.
//
// Scope por sucursal (Fase 2): el CATÁLOGO de proveedores es compartido entre
// sucursales (un proveedor no es "de una sucursal"), pero las ÓRDENES DE
// COMPRA y los PAGOS se scopean a la sucursal activa del JWT — createOrder la
// estampa al crear la orden, los listados/detalle filtran por ella. Por eso
// requireActiveTienda va en todo el módulo: siempre se opera "parado" en una
// sucursal, aunque el proveedor en sí se vea desde cualquiera.
const canUseSuppliers = [authorize('OWNER', 'ADMIN', 'SELLER'), requireActiveTienda];

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
