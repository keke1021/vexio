const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  addItem, getOpenLot, dispatch, receiveItem, receiveAll, cancelItem,
  getTransfers, getTransferById,
  getDeliveries, createDelivery, updateDelivery,
} = require('../controllers/stockTransfers.controller');

router.use(authenticate);

// IMPORTANTE: /deliveries y /open deben ir ANTES de /:id (mismo motivo que
// /pos/sales antes de /pos/sales/:id, /cash/sessions antes de /:id, etc.)
router.get('/stock-transfers/deliveries',        getDeliveries);
router.post('/stock-transfers/deliveries',       authorize('OWNER', 'ADMIN'), createDelivery);
router.patch('/stock-transfers/deliveries/:id',  authorize('OWNER', 'ADMIN'), updateDelivery);

router.get('/stock-transfers/open', getOpenLot);

router.get('/stock-transfers',       getTransfers);
router.post('/stock-transfers/items', addItem);
router.get('/stock-transfers/:id',   getTransferById);

router.post('/stock-transfers/:id/dispatch',     dispatch);
router.post('/stock-transfers/:id/receive-all',  receiveAll);
router.post('/stock-transfers/:id/items/:itemId/receive', receiveItem);
router.post('/stock-transfers/:id/items/:itemId/cancel',  cancelItem);

module.exports = router;
