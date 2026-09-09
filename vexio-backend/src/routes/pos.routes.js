const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { searchItem, createSale, getSales, getSaleById } = require('../controllers/pos.controller');

const router = express.Router();

// Todas las rutas del POS requieren autenticación
router.use(authenticate);

// Ventas: OWNER/ADMIN/SELLER. TECH no accede (ni por nav ni por URL ni por
// request directo). authorize por-ruta y no como router.use(...): este router
// está montado en el prefijo compartido '/api' y un router.use(authorize)
// afectaría a requests de otros módulos que solo lo atraviesan.
const canSell = authorize('OWNER', 'ADMIN', 'SELLER');

// Búsqueda de items disponibles (usada por el POS en tiempo real)
router.get('/pos/search-item', canSell, searchItem);

// Ventas
// IMPORTANTE: /pos/sales debe estar ANTES de /pos/sales/:id
router.get('/pos/sales', canSell, getSales);
router.get('/pos/sales/:id', canSell, getSaleById);
router.post('/pos/sales', canSell, createSale);

module.exports = router;
