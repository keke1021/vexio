const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  addItem, getOpenLot, dispatch, receiveItem, receiveAll, cancelItem,
  getTransfers, getTransferById,
  getDeliveries, createDelivery, updateDelivery,
} = require('../controllers/stockTransfers.controller');

router.use(authenticate);

// Transferencias (módulo multibranch). Dos niveles de autorización:
//
//  1) authorize(...) por-ruta acá — quién puede tocar el módulo.
//  2) assertTiendaAccess(req.user, tiendaId) DENTRO del controller — de qué
//     sucursal puntual. Para OWNER/ADMIN/SUPERADMIN es un bypass; para
//     SELLER/TECH exige que su req.user.tiendaId sea el origen o el destino de
//     ESA transferencia. Todos los endpoints operativos ya lo tienen (addItem
//     → fromTiendaId, dispatch → fromTiendaId, receive* → toTiendaId,
//     getOpenLot → fromTiendaId, getTransferById → origen||destino).
//
// Reparto por rol:
//  - Operar el flujo de la propia sucursal (armar lote, despachar, recibir,
//    ver el lote puntual) → OWNER/ADMIN/SELLER/TECH + assertTiendaAccess.
//  - Gestión de una transferencia ya creada (cancelar ítems, ABM del catálogo
//    de fleteros) → solo OWNER/ADMIN.
//  - GET /stock-transfers lo pueden pegar los 4 roles, PERO SELLER/TECH están
//    obligados a mandar ?tiendaId= (su sucursal): el listado completo del
//    tenant sin filtrar sigue siendo exclusivo de OWNER/ADMIN (chequeo en el
//    controller, getTransfers).
//
// authorize por-ruta y NO como router.use(...): este router está montado en el
// prefijo compartido '/api', así que un router.use(authorize) rechazaría
// también requests de otros módulos (pos, repairs, cash...) que apenas
// atraviesan este router antes de caer en el suyo.
const canOperate = authorize('OWNER', 'ADMIN', 'SELLER', 'TECH');
const ownerOnly  = authorize('OWNER', 'ADMIN');

// IMPORTANTE: /deliveries y /open deben ir ANTES de /:id (mismo motivo que
// /pos/sales antes de /pos/sales/:id, /cash/sessions antes de /:id, etc.)
router.get('/stock-transfers/deliveries',        canOperate, getDeliveries);   // lo necesita el dispatch para elegir fletero
router.post('/stock-transfers/deliveries',       ownerOnly,  createDelivery);
router.patch('/stock-transfers/deliveries/:id',  ownerOnly,  updateDelivery);

router.get('/stock-transfers/open', canOperate, getOpenLot);

router.get('/stock-transfers',       canOperate, getTransfers);      // OWNER/ADMIN: todo · SELLER/TECH: obligatorio ?tiendaId= propia (ver getTransfers)
router.post('/stock-transfers/items', canOperate, addItem);          // crear / agregar al lote OPEN
router.get('/stock-transfers/:id',   canOperate, getTransferById);   // ver una transferencia puntual (assertTiendaAccess adentro)

router.post('/stock-transfers/:id/dispatch',     canOperate, dispatch);        // origen despacha
router.post('/stock-transfers/:id/receive-all',  canOperate, receiveAll);      // destino recibe todo
router.post('/stock-transfers/:id/items/:itemId/receive', canOperate, receiveItem);  // destino recibe un ítem
router.post('/stock-transfers/:id/items/:itemId/cancel',  ownerOnly,  cancelItem);   // cancelar una transferencia ya creada

module.exports = router;
