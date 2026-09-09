const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { createTicket, getTickets, getTicketById, addReply, updateStatus, streamTicket } = require('../controllers/tickets.controller');

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

// SSE: antes de authenticate porque EventSource no puede enviar Authorization header
router.get('/tickets/:id/stream', streamTicket);

router.use(authenticate);

// Soporte: OWNER/ADMIN/SELLER. TECH solo tiene acceso al módulo de
// Reparaciones — no ve ni el nav de Soporte ni estos endpoints.
const canUseTickets = authorize('OWNER', 'ADMIN', 'SELLER');

router.post('/tickets',              canUseTickets, upload.array('attachments', 3), createTicket);
router.get('/tickets',               canUseTickets, getTickets);
router.get('/tickets/:id',           canUseTickets, getTicketById);
router.post('/tickets/:id/reply',    canUseTickets, upload.array('attachments', 3), addReply);
router.put('/tickets/:id/status',    canUseTickets, updateStatus);

module.exports = router;
