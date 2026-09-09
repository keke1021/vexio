const express = require('express');
const { authenticate, authorize, requireActiveTienda } = require('../middlewares/auth.middleware');
const {
  getStats, getTechnicians,
  getAll, getById, createRepair, updateRepair, takeRepair, addComment, deleteRepair,
} = require('../controllers/repairs.controller');

const router = express.Router();

router.use(authenticate);

// Reparaciones: acceso para OWNER/ADMIN/SELLER/TECH (es el único módulo al que
// entra TECH).
//   - Dimensión ROL (sin cambios): "TECH ve/edita solo sus órdenes asignadas"
//     lo resuelve el controller (roleScope). Borrar queda para OWNER/ADMIN/SELLER.
//   - Dimensión SUCURSAL (Fase 2): OWNER/ADMIN/SELLER ven solo las de su
//     sucursal activa; TECH ve las de TODAS las sucursales combinadas
//     (excepción explícita) — requireActiveTienda deja pasar a TECH.
router.get('/repairs/stats', requireActiveTienda, getStats);
router.get('/repairs/technicians', getTechnicians); // lookup tenant-wide

router.get('/repairs', requireActiveTienda, getAll);
router.get('/repairs/:id', requireActiveTienda, getById);
router.post('/repairs', requireActiveTienda, createRepair);
router.put('/repairs/:id', requireActiveTienda, updateRepair);
router.post('/repairs/:id/take', requireActiveTienda, takeRepair);
router.post('/repairs/:id/comments', requireActiveTienda, addComment);
router.delete('/repairs/:id', authorize('OWNER', 'ADMIN', 'SELLER'), requireActiveTienda, deleteRepair);

module.exports = router;
