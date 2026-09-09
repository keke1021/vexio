const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
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

// ─── Products / Tiendas (lookups para formularios) ────────────────────────────
router.get('/products', canUseInventory, getProducts);
router.get('/tiendas',  canUseInventory, getTiendas);

// ─── Inventory ────────────────────────────────────────────────────────────────
// IMPORTANTE: rutas estáticas ANTES de /:id
router.get('/inventory/alerts', canUseInventory, getAlerts);
router.post('/inventory/bulk-upload', canUseInventory, upload.single('file'), bulkUpload);
router.get('/inventory', canUseInventory, getAll);
router.get('/inventory/:id', canUseInventory, getById);
router.post('/inventory', canUseInventory, create);
router.put('/inventory/:id', canUseInventory, update);
router.delete('/inventory/:id', canUseInventory, remove);

// ─── Suppliers (shadowed por suppliers.routes.js, montado antes; se mantienen
//     con el mismo gate por consistencia) ───────────────────────────────────
router.get('/suppliers', canUseInventory, getSuppliers);
router.post('/suppliers', canUseInventory, createSupplier);

module.exports = router;
