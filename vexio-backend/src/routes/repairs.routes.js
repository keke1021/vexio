const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  getStats, getTechnicians,
  getAll, getById, createRepair, updateRepair, deleteRepair,
} = require('../controllers/repairs.controller');

const router = express.Router();

router.use(authenticate);

// IMPORTANTE: rutas fijas deben ir ANTES de /:id para evitar conflictos de parámetros
router.get('/repairs/stats', getStats);
router.get('/repairs/technicians', getTechnicians);

router.get('/repairs', getAll);
router.get('/repairs/:id', getById);
router.post('/repairs', createRepair);
router.put('/repairs/:id', updateRepair);
router.delete('/repairs/:id', authorize('OWNER'), deleteRepair);

module.exports = router;
