const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { searchItem, createSale, getSales, getSaleById } = require('../controllers/pos.controller');

const router = express.Router();

// Todas las rutas del POS requieren autenticación
router.use(authenticate);

// Búsqueda de items disponibles (usada por el POS en tiempo real)
router.get('/pos/search-item', searchItem);

// Ventas
// IMPORTANTE: /pos/sales debe estar ANTES de /pos/sales/:id
router.get('/pos/sales', getSales);
router.get('/pos/sales/:id', getSaleById);
router.post('/pos/sales', createSale);

module.exports = router;
