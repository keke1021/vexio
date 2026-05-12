const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getRates } = require('../controllers/rates.controller');

const router = express.Router();
router.use(authenticate);

router.get('/rates', getRates);

module.exports = router;
