const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  openCash, closeCash, getCurrent,
  addMovement, getMovements, getSummary,
  getSessions, getSessionById,
} = require('../controllers/cash.controller');

router.use(authenticate);

router.get('/cash/current',   getCurrent);
router.get('/cash/movements', getMovements);
router.get('/cash/summary',   getSummary);

// IMPORTANTE: /cash/sessions debe estar ANTES de /cash/sessions/:id
router.get('/cash/sessions',     getSessions);
router.get('/cash/sessions/:id', getSessionById);

router.post('/cash/open',      authorize('OWNER', 'ADMIN'), openCash);
router.post('/cash/close',     authorize('OWNER', 'ADMIN'), closeCash);
router.post('/cash/movements', authorize('OWNER', 'ADMIN'), addMovement);

module.exports = router;
