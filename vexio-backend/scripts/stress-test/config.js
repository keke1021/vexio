/**
 * Configuración central del stress test funcional (Fase 1).
 *
 * Todo lo que define "cuánto" y "cuándo" vive acá — day-simulator.js y
 * audit.js leen de este único lugar, no hay números mágicos repetidos.
 *
 * Diseño aprobado (ver conversación): 2 tiendas, 18 días simulados, 3
 * empleados con rol ADMIN (necesario para que puedan abrir/cerrar caja —
 * cash.controller.js gatea open/close/movements a OWNER/ADMIN, un SELLER no
 * puede), sin StockTransfer entre sucursales (no implementado, cada tienda
 * repone su propio stock de forma independiente).
 */

const path = require('path');

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const SIM_DAYS = parseInt(process.env.STRESS_SIM_DAYS || '18', 10);

// Día calendario simulado 0 = hoy - SIM_DAYS. El tenant y todo lo del
// bootstrap se ante-datan a este momento (mismo criterio que
// seed-demo.js/TENANT_CREATED_AT) para que no aparezca creado "ahora" con
// 18 días de historia ya adentro.
const SIM_START = (() => {
  const d = today();
  d.setDate(d.getDate() - SIM_DAYS);
  d.setHours(8, 0, 0, 0);
  return d;
})();

const RUN_TAG = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
})();

module.exports = {
  BASE_URL: process.env.STRESS_BASE_URL || 'http://localhost:3001/api',

  // Credenciales del SUPERADMIN real — SOLO se usan para las rutas /admin/*
  // (crear tenant, tiendas, usuarios). Nunca se usan para operar dentro del
  // tenant de prueba (ventas/caja/proveedores/inventario) — eso es
  // exclusivamente con los tokens del OWNER/empleados del tenant nuevo, para
  // no escribir por accidente en el tenant real de SyntraTech.
  SUPERADMIN: {
    email: process.env.STRESS_SUPERADMIN_EMAIL || 'ezequiel4600@gmail.com',
    password: process.env.STRESS_SUPERADMIN_PASSWORD || 'admin1234',
  },

  RUN_TAG,
  SIM_DAYS,
  SIM_START,

  TENANT: {
    tenantName: `Stress Test ${RUN_TAG}`,
    tenantSlug: `stress-test-${RUN_TAG}`,
    email: `owner-${RUN_TAG}@stress-test.local`,
    password: 'StressTest2026!',
    name: 'Dueño Stress Test',
    maxUsers: 10,
  },

  TIENDAS: [
    { key: 'A', name: 'Sucursal Centro', address: 'Av. Corrientes 1234, CABA' },
    { key: 'B', name: 'Sucursal Norte', address: 'Av. Cabildo 3456, CABA' },
  ],

  EMPLOYEES: [
    { key: 'emp1', name: 'Empleado Uno — Bruno Ledesma', email: `emp1-${RUN_TAG}@stress-test.local` },
    { key: 'emp2', name: 'Empleado Dos — Carla Nuñez', email: `emp2-${RUN_TAG}@stress-test.local` },
    { key: 'emp3', name: 'Empleado Tres — Iván Roldán', email: `emp3-${RUN_TAG}@stress-test.local` },
  ],
  EMPLOYEE_PASSWORD: 'Empleado2026!',
  EMPLOYEE_ROLE: 'ADMIN', // decisión aprobada — SELLER no puede abrir/cerrar caja

  SUPPLIERS_INITIAL: [
    { name: 'ImportCel SRL', city: 'CABA', paymentDays: 30, phone: '11-4555-2231', email: 'ventas@importcel.com.ar', currency: 'USD' },
    { name: 'Andes Wireless', city: 'Mendoza', paymentDays: 30, phone: '261-433-7710', email: 'info@andeswireless.com', currency: 'USDT' },
  ],
  // Alta nueva del dueño a mitad de la corrida (día index, ver también abajo)
  SUPPLIER_NEW: { name: 'Distribuidora Trade', city: 'CABA', paymentDays: 45, phone: '11-3220-8890', email: 'compras@distritrade.com.ar', currency: 'ARS', dayIndex: 9 },

  SALES_PER_DAY: { min: 20, max: 30 },
  CURRENCY_WEIGHTS: [['ARS', 55], ['USD', 25], ['USDT', 20]],
  PAYMENT_METHOD_WEIGHTS: [['CASH', 40], ['TRANSFER', 30], ['CARD', 20], ['INSTALLMENTS', 10]],
  CUSTOMER_ASSOC_PROB: 0.65,

  MANUAL_MOVEMENTS_PER_TIENDA_PER_DAY: { min: 1, max: 3 },
  CLOSE_ADJUSTMENT_PROB: 0.2, // ~1 de cada 5 cierres, mismo criterio que seed-demo

  REPAIRS_NEW_PER_DAY_PROB: 0.6, // ~0-2 altas nuevas por día
  REPAIRS_UPDATE_PER_DAY_PROB: 0.5,

  OWNER_ACTIVITY_PROB: 0.4, // ~40% de los días, no todos

  // Runway de stock: si el disponible de una tienda cae por debajo de
  // (ventas/día esperadas × este factor), se dispara reposición ese día.
  RESTOCK_RUNWAY_DAYS: 4,
  RESTOCK_BATCH_UNITS: { min: 60, max: 90 }, // por tienda, cuando se repone

  BUSINESS_HOURS: { openHour: 9, openMinuteMax: 30, closeHour: 19, closeMinuteMax: 59 },

  // Cuántas acciones se disparan juntas por tanda (Promise.all) dentro de un
  // día — concurrencia real, no secuencial, pero tampoco todo el día de
  // golpe en un solo Promise.all gigante (más fácil de leer en los logs).
  CONCURRENCY_BATCH_SIZE: 6,

  // ─── Escenarios de contención intencional ──────────────────────────────
  // dayIndex: en qué día simulado (0-indexado) se dispara. type: qué
  // escenario. Ver day-simulator.js para la implementación de cada uno.
  CONTENTION_SCHEDULE: [
    { dayIndex: 2, type: 'DOUBLE_SELL_SAME_IMEI' },
    { dayIndex: 4, type: 'DOUBLE_OPEN_CASH' },
    { dayIndex: 6, type: 'DOUBLE_SELL_SAME_IMEI' },
    { dayIndex: 8, type: 'CLOSE_VS_SALE_RACE' },
    { dayIndex: 10, type: 'SUPPLIER_PAYMENT_VS_SALE_RACE' },
    { dayIndex: 12, type: 'DOUBLE_SELL_SAME_IMEI' },
    { dayIndex: 14, type: 'DOUBLE_OPEN_CASH' },
    { dayIndex: 15, type: 'CLOSE_VS_SALE_RACE' },
    { dayIndex: 16, type: 'SUPPLIER_PAYMENT_VS_SALE_RACE' },
  ],

  // ─── Paths de salida ────────────────────────────────────────────────────
  OUT_DIR: path.join(__dirname, 'out'),
  RUN_LOG_FILE: path.join(__dirname, 'out', `run-log-${RUN_TAG}.jsonl`),
  LAST_RUN_FILE: path.join(__dirname, 'out', 'last-run.json'),
  REPORT_FILE: path.join(__dirname, 'out', `audit-report-${RUN_TAG}.md`),
};
