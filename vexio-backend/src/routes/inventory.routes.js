const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getAll, getAlerts, getById, create, update, remove,
  getSuppliers, createSupplier,
  getProducts, bulkUpload,
} = require('../controllers/inventory.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Todas las rutas de inventario requieren autenticación
router.use(authenticate);

// ─── Products (autocomplete para formularios) ─────────────────────────────────
router.get('/products', getProducts);

// ─── Inventory ────────────────────────────────────────────────────────────────
// IMPORTANTE: rutas estáticas ANTES de /:id
router.get('/inventory/alerts', getAlerts);
router.post('/inventory/bulk-upload', authorize('OWNER', 'ADMIN'), upload.single('file'), bulkUpload);
router.get('/inventory', getAll);
router.get('/inventory/:id', getById);
router.post('/inventory', authorize('OWNER', 'ADMIN'), create);
router.put('/inventory/:id', authorize('OWNER', 'ADMIN'), update);
router.delete('/inventory/:id', authorize('OWNER', 'ADMIN'), remove);

// ─── Suppliers ────────────────────────────────────────────────────────────────
router.get('/suppliers', getSuppliers);
router.post('/suppliers', authorize('OWNER', 'ADMIN'), createSupplier);

module.exports = router;
