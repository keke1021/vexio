const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { listUsers, reassignTienda } = require('../controllers/users.controller');

const router = express.Router();

router.use(authenticate);

// Listado de solo lectura de empleados del tenant: OWNER/ADMIN/SELLER.
// TECH queda afuera (403). authorize POR-RUTA, nunca router.use(authorize) —
// este router cuelga del prefijo compartido '/api' (ver gotcha en otros routers).
router.get('/users', authorize('OWNER', 'ADMIN', 'SELLER'), listUsers);

// Reasignar la sucursal de un empleado: SOLO OWNER. Invalida la sesión activa
// del empleado de inmediato (ver controller).
router.put('/users/:id/tienda', authorize('OWNER'), reassignTienda);

module.exports = router;
