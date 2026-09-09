const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getSalesReport, getProductsReport, getInventoryReport, getRepairsReport, getCashReport,
} = require('../controllers/reports.controller');

router.use(authenticate);

// Reportes (dashboard de Inicio): OWNER/ADMIN/SELLER. TECH no accede.
// authorize por-ruta y NO como router.use(...): este router está montado en el
// prefijo compartido '/api' y ANTES que notifications / tickets / rates, así
// que un router.use(authorize) los rechazaba de rebote (rompía el bell de
// notificaciones para todos los roles no listados).
const canViewReports = authorize('OWNER', 'ADMIN', 'SELLER');

router.get('/reports/sales',     canViewReports, getSalesReport);
router.get('/reports/products',  canViewReports, getProductsReport);
router.get('/reports/inventory', canViewReports, getInventoryReport);
router.get('/reports/repairs',   canViewReports, getRepairsReport);
router.get('/reports/cash',      canViewReports, getCashReport);

module.exports = router;
