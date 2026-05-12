const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { register, login, logout, refresh, changePassword } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', register);
router.post('/login',    login);
router.post('/logout',   logout);
router.post('/refresh',  refresh);
router.put('/password',  authenticate, changePassword);

module.exports = router;
