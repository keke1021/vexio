const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { createTicket, getTickets, getTicketById, addReply, updateStatus } = require('../controllers/tickets.controller');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se aceptan imágenes.'), false);
  },
});

router.use(authenticate);

router.post('/tickets',              upload.array('attachments', 3), createTicket);
router.get('/tickets',               getTickets);
router.get('/tickets/:id',           getTicketById);
router.post('/tickets/:id/reply',    upload.array('attachments', 3), addReply);
router.put('/tickets/:id/status',    updateStatus);

module.exports = router;
