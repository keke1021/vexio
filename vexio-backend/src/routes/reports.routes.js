const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getSalesReport, getProductsReport, getInventoryReport, getRepairsReport, getCashReport,
} = require('../controllers/reports.controller');

router.use(authenticate);
router.use(authorize('OWNER', 'ADMIN'));

router.get('/reports/sales',     getSalesReport);
router.get('/reports/products',  getProductsReport);
router.get('/reports/inventory', getInventoryReport);
router.get('/reports/repairs',   getRepairsReport);
router.get('/reports/cash',      getCashReport);

module.exports = router;
