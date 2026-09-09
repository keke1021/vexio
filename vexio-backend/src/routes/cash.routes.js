const express = require('express');
const router = express.Router();
const { authenticate, authorize, requireActiveTienda } = require('../middlewares/auth.middleware');
const {
  openCash, closeCash, getCurrent,
  addMovement, getMovements, getSummary,
  getSessions, getSessionById,
} = require('../controllers/cash.controller');

router.use(authenticate);

// Caja: OWNER/ADMIN/SELLER acceso completo (lectura y escritura). TECH no
// accede a nada de Caja.
// NB: authorize / requireActiveTienda por-ruta y NO como router.use(...) —
// este router está montado en el prefijo compartido '/api', así que un
// router.use(...) se ejecutaría también para requests de otros módulos que
// apenas pasan por acá antes de caer en su router real.
// requireActiveTienda: toda operación de Caja es de UNA sucursal (la activa
// del JWT). El backend ignora cualquier tiendaId que venga en query/body.
const canUseCash = [authorize('OWNER', 'ADMIN', 'SELLER'), requireActiveTienda];

router.get('/cash/current',   canUseCash, getCurrent);
router.get('/cash/movements', canUseCash, getMovements);
router.get('/cash/summary',   canUseCash, getSummary);

// IMPORTANTE: /cash/sessions debe estar ANTES de /cash/sessions/:id
router.get('/cash/sessions',     canUseCash, getSessions);
router.get('/cash/sessions/:id', canUseCash, getSessionById);

router.post('/cash/open',      canUseCash, openCash);
router.post('/cash/close',     canUseCash, closeCash);
router.post('/cash/movements', canUseCash, addMovement);

module.exports = router;
