const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  openCash, closeCash, getCurrent,
  addMovement, getMovements, getSummary,
  getSessions, getSessionById,
} = require('../controllers/cash.controller');

router.use(authenticate);

// Caja: OWNER/ADMIN/SELLER pueden ver; TECH no accede (ni por nav ni por URL
// ni por request directo). Las escrituras (open/close/movements) siguen
// restringidas a OWNER/ADMIN.
// NB: el authorize va por-ruta y NO como router.use(...) — este router está
// montado en el prefijo compartido '/api', así que un router.use(authorize)
// se ejecutaría también para requests de otros módulos que apenas pasan por
// acá antes de caer en su router real (mismo criterio que el resto del repo).
const canView = authorize('OWNER', 'ADMIN', 'SELLER');

router.get('/cash/current',   canView, getCurrent);
router.get('/cash/movements', canView, getMovements);
router.get('/cash/summary',   canView, getSummary);

// IMPORTANTE: /cash/sessions debe estar ANTES de /cash/sessions/:id
router.get('/cash/sessions',     canView, getSessions);
router.get('/cash/sessions/:id', canView, getSessionById);

router.post('/cash/open',      authorize('OWNER', 'ADMIN'), openCash);
router.post('/cash/close',     authorize('OWNER', 'ADMIN'), closeCash);
router.post('/cash/movements', authorize('OWNER', 'ADMIN'), addMovement);

module.exports = router;
