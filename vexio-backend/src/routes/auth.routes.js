const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/auth.middleware');
const { register, login, logout, refresh, changePassword } = require('../controllers/auth.controller');

const router = express.Router();

// Anti fuerza bruta: 5 intentos por IP cada 15 minutos, SOLO sobre /login.
// skipSuccessfulRequests => un login exitoso no consume cuota; sólo cuentan
// los intentos fallidos. Depende de `app.set('trust proxy', 1)` en index.js
// para tomar la IP real del cliente detrás del proxy de Railway.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de inicio de sesión. Probá de nuevo en 15 minutos.' },
});

router.post('/register', register);
router.post('/login',    loginLimiter, login);
router.post('/logout',   logout);
router.post('/refresh',  refresh);
router.put('/password',  authenticate, changePassword);

module.exports = router;
