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

// Reparaciones: acceso para OWNER/ADMIN/SELLER/TECH (es el único módulo al que
// entra TECH). El scope fino "TECH ve/edita solo sus órdenes asignadas" lo
// resuelve el controller (roleScope). Borrar una orden queda para el tier
// completo OWNER/ADMIN/SELLER (no TECH).
router.get('/repairs', getAll);
router.get('/repairs/:id', getById);
router.post('/repairs', createRepair);
router.put('/repairs/:id', updateRepair);
router.delete('/repairs/:id', authorize('OWNER', 'ADMIN', 'SELLER'), deleteRepair);

module.exports = router;
