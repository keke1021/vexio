require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { PrismaClient } = require('@prisma/client');

const authRoutes          = require('./routes/auth.routes');
const inventoryRoutes     = require('./routes/inventory.routes');
const posRoutes           = require('./routes/pos.routes');
const repairsRoutes       = require('./routes/repairs.routes');
const cashRoutes          = require('./routes/cash.routes');
const suppliersRoutes     = require('./routes/suppliers.routes');
const reportsRoutes       = require('./routes/reports.routes');
const adminRoutes         = require('./routes/admin.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const ticketsRoutes       = require('./routes/tickets.routes');
const ratesRoutes         = require('./routes/rates.routes');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', authRoutes);
app.use('/api', suppliersRoutes);     // antes que inventoryRoutes
app.use('/api', inventoryRoutes);
app.use('/api', posRoutes);
app.use('/api', repairsRoutes);
app.use('/api', cashRoutes);
app.use('/api', reportsRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', ticketsRoutes);
app.use('/api', ratesRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Vexio Backend corriendo en http://localhost:${PORT}`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  shutdown();
});

module.exports = app;
