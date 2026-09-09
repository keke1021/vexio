const express = require('express');
const multer = require('multer');
const { authenticate, authorize, requireActiveTienda } = require('../middlewares/auth.middleware');
const {
  getAll, getAlerts, getById, create, update, remove,
  getSuppliers, createSupplier,
  getProducts, getTiendas, bulkUpload,
} = require('../controllers/inventory.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

// Inventario (y sus lookups /products y /tiendas, que consumen los formularios
// de Inventario/Caja/Transferencias): OWNER/ADMIN/SELLER acceso completo.
// TECH no accede a nada de acá.
const canUseInventory = authorize('OWNER', 'ADMIN', 'SELLER');
// El stock es POR SUCURSAL: cada endpoint de /inventory opera sobre la sucursal
// activa del JWT e ignora cualquier tiendaId de query/body.
const scopedInventory = [canUseInventory, requireActiveTienda];

// ─── Products / Tiendas (lookups tenant-wide para formularios) ────────────────
// /products (autocomplete de modelos): OWNER/ADMIN/SELLER.
// /tiendas: cualquier usuario autenticado del tenant — es solo la lista de
// sucursales (no datos sensibles), y la precisan el selector de sucursal, el
// destino de transferencias y el alta de reparaciones de un TECH (que elige de
// qué sucursal viene el equipo). Sin requireActiveTienda (justamente sirve
// para elegir una).
router.get('/products', canUseInventory, getProducts);
router.get('/tiendas',  getTiendas);

// ─── Inventory (scopeado a la sucursal activa) ───────────────────────────────
// IMPORTANTE: rutas estáticas ANTES de /:id
router.get('/inventory/alerts', scopedInventory, getAlerts);
router.post('/inventory/bulk-upload', scopedInventory, upload.single('file'), bulkUpload);
router.get('/inventory', scopedInventory, getAll);
router.get('/inventory/:id', scopedInventory, getById);
router.post('/inventory', scopedInventory, create);
router.put('/inventory/:id', scopedInventory, update);
router.delete('/inventory/:id', scopedInventory, remove);

// ─── Suppliers (shadowed por suppliers.routes.js, montado antes; se mantienen
//     con el mismo gate por consistencia) ───────────────────────────────────
router.get('/suppliers', canUseInventory, getSuppliers);
router.post('/suppliers', canUseInventory, createSupplier);

module.exports = router;
