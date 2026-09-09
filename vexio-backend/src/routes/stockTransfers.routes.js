const express = require('express');
const router = express.Router();
const { authenticate, authorize, requireActiveTienda } = require('../middlewares/auth.middleware');
const {
  addItem, getOpenLot, dispatch, receiveItem, receiveAll, cancelItem,
  getTransfers, getTransferById,
  getDeliveries, createDelivery, updateDelivery,
} = require('../controllers/stockTransfers.controller');

router.use(authenticate);

// Transferencias (módulo multibranch): OWNER/ADMIN/SELLER acceso completo.
// TECH no accede a nada de Transferencias.
// authorize / requireActiveTienda por-ruta y NO como router.use(...): este
// router está montado en el prefijo compartido '/api', así que un
// router.use(...) rechazaría también requests de otros módulos (pos, repairs,
// cash...) que apenas atraviesan este router antes de caer en el suyo.
// El controller valida cada endpoint contra la sucursal activa del JWT vía
// assertTiendaAccess (origen para sacar/despachar, destino para recibir) —
// reactivado en Fase 2 (utils/tiendaAuth.js: solo SUPERADMIN es unrestricted).
const canUseTransfers = [authorize('OWNER', 'ADMIN', 'SELLER'), requireActiveTienda];

// IMPORTANTE: /deliveries y /open deben ir ANTES de /:id (mismo motivo que
// /pos/sales antes de /pos/sales/:id, /cash/sessions antes de /:id, etc.)
router.get('/stock-transfers/deliveries',        canUseTransfers, getDeliveries);
router.post('/stock-transfers/deliveries',       canUseTransfers, createDelivery);
router.patch('/stock-transfers/deliveries/:id',  canUseTransfers, updateDelivery);

router.get('/stock-transfers/open', canUseTransfers, getOpenLot);

router.get('/stock-transfers',        canUseTransfers, getTransfers);
router.post('/stock-transfers/items', canUseTransfers, addItem);
router.get('/stock-transfers/:id',    canUseTransfers, getTransferById);

router.post('/stock-transfers/:id/dispatch',     canUseTransfers, dispatch);
router.post('/stock-transfers/:id/receive-all',  canUseTransfers, receiveAll);
router.post('/stock-transfers/:id/items/:itemId/receive', canUseTransfers, receiveItem);
router.post('/stock-transfers/:id/items/:itemId/cancel',  canUseTransfers, cancelItem);

module.exports = router;
