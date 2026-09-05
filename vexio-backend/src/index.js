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

// Orígenes permitidos: configurables por env var (coma-separado), con
// fallback a los puertos de dev de Vite para no romper `npm run dev` si
// ALLOWED_ORIGINS no está seteada. En producción, setear ALLOWED_ORIGINS
// con el/los dominio(s) reales del frontend.
const DEFAULT_DEV_ORIGINS = 'http://localhost:5173,http://localhost:3000';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_DEV_ORIGINS)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Sin header Origin (curl, health checks, requests server-to-server) se permite.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[CORS] Origen bloqueado: ${origin}`);
    return callback(new Error('No permitido por CORS'));
  },
}));
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

// Shutdown controlado: deja de aceptar conexiones nuevas y da un margen para
// que terminen los requests en vuelo antes de cerrar. Ante un unhandledRejection
// asumimos que el estado del proceso puede estar comprometido (conexión de
// Prisma en un estado raro, handle colgado, etc.) — no seguimos operando con
// eso, salimos con código 1 y dejamos que el process manager del PaaS
// (Railway/Render/PM2/etc.) reinicie el proceso. Con SIGINT/SIGTERM (deploy,
// restart manual) el cierre es igual de prolijo pero con código 0.
let isShuttingDown = false;

const shutdown = (exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Cerrando servidor (exit code ${exitCode})...`);

  // Si algún request en vuelo (o una conexión keep-alive) no cierra sola,
  // no nos quedamos colgados esperando: forzamos la salida igual.
  const forceExitTimer = setTimeout(() => {
    console.error('Timeout esperando conexiones en vuelo, forzando cierre.');
    process.exit(exitCode);
  }, 10_000);
  forceExitTimer.unref();

  server.close(async () => {
    clearTimeout(forceExitTimer);
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error('Error desconectando Prisma durante el shutdown:', disconnectError);
    }
    process.exit(exitCode);
  });
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Promesa no manejada, reiniciando el proceso:');
  console.error(reason instanceof Error ? reason.stack : reason);
  shutdown(1);
});

module.exports = app;
