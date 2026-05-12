const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { getNotifications, markAsRead, markAllAsRead } = require('../controllers/notifications.controller');

const router = express.Router();
router.use(authenticate);

router.get('/notifications',              getNotifications);
router.put('/notifications/read-all',     markAllAsRead);
router.put('/notifications/:id/read',     markAsRead);

module.exports = router;
