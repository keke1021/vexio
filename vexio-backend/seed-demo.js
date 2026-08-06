/**
 * Dataset de demo para ventas — tenant "TechStore Demo".
 *
 * Genera un tenant aislado, con ~2 meses de actividad realista (stock,
 * caja multi-moneda, proveedores, reparaciones) para grabar capturas/video
 * de venta a prospectos. Pensado para correrse las veces que haga falta:
 * SIEMPRE borra por completo el tenant demo anterior (si existe) antes de
 * recrearlo — nunca deja basura de corridas previas, nunca duplica.
 *
 * Determinístico: usa un PRNG con seed fija (mulberry32), así que dos
 * corridas cualquiera producen exactamente el mismo dataset (mismos montos,
 * mismas fechas relativas a "hoy") — importante para no sorprenderse en
 * medio de una grabación si hace falta resetear entre tomas.
 *
 * El tenant se identifica SIEMPRE por DEMO_SLUG (no por nombre) — así el
 * nombre visible se puede editar a mano después sin que la próxima corrida
 * deje de encontrarlo. Nunca toca ningún otro tenant.
 *
 * Uso: npm run seed:demo   (desde vexio-backend/)
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();

// ─── Identidad del tenant demo ─────────────────────────────────────────────

const DEMO_SLUG = 'techstore-demo'; // fuente de verdad para encontrar/borrar el tenant demo, NO el nombre
const DEMO_NAME = 'TechStore Demo';
const DEMO_TENANT_EMAIL = 'contacto@techstoredemo.com';
const DEMO_PASSWORD = 'Demo2026!'; // misma password para los 3 usuarios demo, ver resumen final

const TIENDA_NAME = 'TechStore Demo';
const TIENDA_ADDRESS = 'Av. Rivadavia 4550, CABA';

const USERS = {
  OWNER:  { name: 'Martina Suárez',  email: 'martina@techstoredemo.com', role: 'OWNER' },
  SELLER: { name: 'Nicolás Paz',     email: 'nico@techstoredemo.com',    role: 'SELLER' },
  TECH:   { name: 'Diego Fernández', email: 'diego@techstoredemo.com',   role: 'TECH' },
};

// ─── PRNG determinístico (mulberry32) — mismo dataset en cada corrida ─────

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260806);
const chance = (p) => rand() < p;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickWeighted = (weighted) => {
  // weighted: [[value, weight], ...]
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of weighted) {
    if ((r -= w) <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
};
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randFloat = (min, max) => rand() * (max - min) + min;
const uuid = () => crypto.randomUUID();

// ─── Fechas ─────────────────────────────────────────────────────────────────

const TODAY = new Date();
const TENANT_CREATED_AT = (() => {
  const d = new Date(TODAY);
  d.setMonth(d.getMonth() - 2);
  return d;
})();

const atTime = (date, hour, minute) => {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

// Días activos del negocio entre la creación del tenant y hoy: se saltea
// domingo entero, y ~18% de los días restantes también (no todos los
// negocios abren 6/6 — un local real tiene algún día suelto cerrado).
const ACTIVE_DAYS = [];
for (let d = new Date(TENANT_CREATED_AT); d <= TODAY; d = addDays(d, 1)) {
  if (d.getDay() === 0) continue; // domingo
  if (!chance(0.82)) continue;
  ACTIVE_DAYS.push(new Date(d));
}

// ─── Tasas de cambio simuladas para el período (tendencia realista: el
// dólar/USDT blue sube gradualmente en 2 meses, con ruido diario) ──────────

const usdArsRate = (date) => {
  const t = (date - TENANT_CREATED_AT) / (TODAY - TENANT_CREATED_AT);
  const base = 1180 + t * (1245 - 1180);
  return parseFloat((base * (1 + randFloat(-0.006, 0.006))).toFixed(2));
};
const usdtArsRate = (date) => {
  const t = (date - TENANT_CREATED_AT) / (TODAY - TENANT_CREATED_AT);
  const base = 1170 + t * (1235 - 1170);
  return parseFloat((base * (1 + randFloat(-0.006, 0.006))).toFixed(2));
};

// ─── Catálogo de productos (22) ─────────────────────────────────────────────
// idx 2, 7 y 14 son las "vitrinas" de stock bajo (1 sola unidad, minStock=3
// más alto que el resto) — el resto tiene minStock=0 para no disparar
// alertas sin querer al vender una unidad.

const PRODUCTS = [
  { name: 'iPhone 11',          color: 'Negro',            storage: '64GB',  units: 2 },
  { name: 'iPhone 11',          color: 'Blanco',           storage: '128GB', units: 3 },
  { name: 'iPhone 11',          color: 'Rojo',             storage: '128GB', units: 1, lowStock: true },
  { name: 'iPhone 11 Pro',      color: 'Gris Espacial',    storage: '64GB',  units: 2 },
  { name: 'iPhone 12',          color: 'Azul',             storage: '64GB',  units: 2 },
  { name: 'iPhone 12',          color: 'Blanco',           storage: '128GB', units: 3 },
  { name: 'iPhone 12',          color: 'Negro',            storage: '128GB', units: 2 },
  { name: 'iPhone 12 Pro',      color: 'Grafito',          storage: '128GB', units: 1, lowStock: true },
  { name: 'iPhone 12 Pro',      color: 'Oro',              storage: '256GB', units: 2 },
  { name: 'iPhone 13',          color: 'Medianoche',       storage: '128GB', units: 3 },
  { name: 'iPhone 13',          color: 'Rosa',             storage: '128GB', units: 2 },
  { name: 'iPhone 13',          color: 'Celeste',          storage: '256GB', units: 2 },
  { name: 'iPhone 13 Pro',      color: 'Alpino',           storage: '256GB', units: 2 },
  { name: 'iPhone 13 Pro Max',  color: 'Grafito',          storage: '256GB', units: 2 },
  { name: 'iPhone 13 Pro Max',  color: 'Plata',            storage: '512GB', units: 1, lowStock: true },
  { name: 'iPhone 14',          color: 'Medianoche',       storage: '128GB', units: 3 },
  { name: 'iPhone 14',          color: 'Púrpura',          storage: '256GB', units: 2 },
  { name: 'iPhone 14',          color: 'Azul',             storage: '128GB', units: 2 },
  { name: 'iPhone 14 Pro',      color: 'Morado Oscuro',    storage: '128GB', units: 2 },
  { name: 'iPhone 14 Pro',      color: 'Espacial Negro',   storage: '256GB', units: 2 },
  { name: 'iPhone 14 Pro Max',  color: 'Dorado',           storage: '256GB', units: 2 },
  { name: 'iPhone 14 Pro Max',  color: 'Plata',            storage: '512GB', units: 2 },
];

// Moneda por producto — rotación fija para garantizar mezcla real (no
// aleatoria por corrida: determinística, como todo lo demás acá).
const CURRENCY_CYCLE = ['ARS', 'USD', 'USDT', 'ARS', 'USD', 'ARS', 'USDT', 'USD'];

const PRICE_RANGES = {
  ARS:  { min: 700000, max: 1500000 },
  USD:  { min: 500,    max: 1700 },
  USDT: { min: 500,    max: 1700 },
};

// Ventana de precio dentro del rango según condición — así ningún estado
// (ni siquiera NEW) queda pegado siempre al techo del rango.
const CONDITION_WINDOW = {
  NEW:         [0.65, 1.00],
  LIKE_NEW:    [0.55, 0.85],
  REFURBISHED: [0.40, 0.70],
  USED:        [0.30, 0.60],
};
const CONDITION_WEIGHTS = [['NEW', 35], ['LIKE_NEW', 30], ['REFURBISHED', 20], ['USED', 15]];

const priceForCurrency = (currencyCode, condition) => {
  const { min, max } = PRICE_RANGES[currencyCode];
  const [lo, hi] = CONDITION_WINDOW[condition];
  const price = min + randFloat(lo, hi) * (max - min);
  return parseFloat(price.toFixed(2));
};

// ─── Descripciones realistas para movimientos manuales de caja ────────────

const EXPENSE_DESCRIPTIONS = [
  'Pago de alquiler del local',
  'Pago de expensas',
  'Servicio de internet y telefonía',
  'Pago de luz',
  'Pago de ABL / impuestos municipales',
  'Compra de insumos de limpieza',
  'Compra de fundas y protectores de pantalla',
  'Comisión Mercado Pago',
  'Adelanto de sueldo — empleado',
  'Pago de honorarios contables',
  'Reparación de vidriera',
  'Compra de cajas y packaging',
  'Viáticos — retiro de mercadería',
];
const INCOME_DESCRIPTIONS = [
  'Aporte de capital',
  'Venta de accesorio suelto (funda/cargador)',
  'Venta de equipo por WhatsApp — seña',
  'Devolución de proveedor',
];

// ─── Proveedores ────────────────────────────────────────────────────────────

const SUPPLIERS = [
  { name: 'ImportCel SRL',        city: 'CABA',          paymentDays: 30, phone: '11-4555-2231', email: 'ventas@importcel.com.ar', currency: 'USD' },
  { name: 'MegaPhone Mayorista',  city: 'Córdoba',       paymentDays: 15, phone: '351-455-9021', email: 'pedidos@megaphone.com.ar', currency: 'USDT' },
  { name: 'Andes Wireless',       city: 'Mendoza',       paymentDays: 30, phone: '261-433-7710', email: 'info@andeswireless.com',   currency: 'USD' },
  { name: 'Distribuidora Trade',  city: 'CABA',          paymentDays: 45, phone: '11-3220-8890', email: 'compras@distritrade.com.ar', currency: 'ARS' },
];

// ─── Reparaciones ───────────────────────────────────────────────────────────

const FAULT_DESCRIPTIONS = {
  SCREEN:   ['Pantalla rota con manchas', 'Táctil no responde en la esquina inferior', 'Pantalla con líneas verticales'],
  BATTERY:  ['Batería se descarga muy rápido', 'Se apaga solo al 20%', 'Salud de batería al 68%'],
  CHARGING: ['No carga salvo moviendo el cable', 'Puerto de carga sucio/dañado', 'Carga muy lento'],
  CAMERA:   ['Cámara trasera desenfocada', 'Cámara frontal no abre', 'Vidrio de cámara rajado'],
  SPEAKER:  ['No se escucha en llamadas', 'Parlante inferior con distorsión', 'Sin sonido en videos'],
  BUTTON:   ['Botón de volumen trabado', 'Botón lateral no responde'],
  WATER:    ['Cayó en agua, no enciende', 'Contacto con humedad, pantalla parpadea'],
  SOFTWARE: ['Reinicios aleatorios', 'No actualiza iOS', 'Bloqueado en manzana'],
  OTHER:    ['Revisión general antes de vender', 'Diagnóstico por garantía'],
};
const REPAIR_DEVICE_POOL = ['iPhone 11', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 13', 'iPhone 13 Pro Max', 'iPhone 14', 'iPhone 14 Pro'];
const CUSTOMER_FIRST = ['Juan', 'Sofía', 'Mateo', 'Valentina', 'Lucas', 'Camila', 'Tomás', 'Julieta', 'Bruno', 'Agustina', 'Franco', 'Micaela', 'Ignacio', 'Renata'];
const CUSTOMER_LAST = ['González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Díaz', 'Romero', 'Sosa', 'Torres', 'Acosta', 'Benítez', 'Molina'];
const randomCustomerName = () => `${pick(CUSTOMER_FIRST)} ${pick(CUSTOMER_LAST)}`;
const randomPhone = () => `11-${randInt(3000, 6999)}-${randInt(1000, 9999)}`;

// ─── Borrado del tenant demo anterior (si existe) ──────────────────────────
// Orden estricto: hijos antes que padres, respetando las FKs del schema
// (la mayoría son RESTRICT, no CASCADE — ver schema.prisma). Nunca toca
// Notification con tenantId null (notificaciones globales de SUPERADMIN).

async function wipeDemoTenant(tx, tenantId) {
  await tx.ledgerEntry.deleteMany({ where: { tenantId } });
  await tx.conversion.deleteMany({ where: { tenantId } });
  await tx.supplierPayment.deleteMany({ where: { tenantId } });
  await tx.cashMovement.deleteMany({ where: { tenantId } });
  await tx.sale.deleteMany({ where: { tenantId } }); // cascade → SaleItem
  await tx.cashSession.deleteMany({ where: { tenantId } });
  await tx.purchaseOrder.deleteMany({ where: { tenantId } }); // cascade → PurchaseOrderItem
  await tx.payment.deleteMany({ where: { tenantId } });
  await tx.repairOrder.deleteMany({ where: { tenantId } }); // cascade → RepairStatusHistory
  await tx.customer.deleteMany({ where: { tenantId } });
  await tx.inventoryItem.deleteMany({ where: { tenantId } });
  await tx.stockTransfer.deleteMany({ where: { tenantId } });
  await tx.product.deleteMany({ where: { tenantId } });
  await tx.supplier.deleteMany({ where: { tenantId } });
  await tx.notification.deleteMany({ where: { tenantId } });
  await tx.supportTicket.deleteMany({ where: { tenantId } }); // cascade → TicketReply
  await tx.user.deleteMany({ where: { tenantId } }); // cascade → RefreshToken
  await tx.tienda.deleteMany({ where: { tenantId } });
  await tx.tenant.delete({ where: { id: tenantId } });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Currency global — idempotente, por si este script corre en una DB que
  // nunca ejecutó prisma/seed.js.
  for (const c of [
    { code: 'ARS', name: 'Peso Argentino', symbol: '$' },
    { code: 'USD', name: 'Dólar Estadounidense', symbol: 'US$' },
    { code: 'USDT', name: 'Tether (USDT)', symbol: '₮' },
  ]) {
    await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) {
    console.log(`[seed-demo] Tenant demo existente encontrado (${existing.id}) — borrando...`);
    await prisma.$transaction(async (tx) => wipeDemoTenant(tx, existing.id), { timeout: 120000 });
    console.log('[seed-demo] Borrado OK.');
  } else {
    console.log('[seed-demo] No había tenant demo previo — creando desde cero.');
  }

  console.log('[seed-demo] Generando dataset...');

  await prisma.$transaction(async (tx) => {
    // ── Tenant + Tienda + Usuarios ──────────────────────────────────────
    const tenant = await tx.tenant.create({
      data: {
        name: DEMO_NAME,
        slug: DEMO_SLUG,
        email: DEMO_TENANT_EMAIL,
        status: 'ACTIVE',
        plan: 'FULL',
        activeModules: ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties', 'reports'],
        maxUsers: 10,
        createdAt: TENANT_CREATED_AT,
      },
    });

    const tienda = await tx.tienda.create({
      data: { name: TIENDA_NAME, address: TIENDA_ADDRESS, tenantId: tenant.id, createdAt: TENANT_CREATED_AT },
    });

    const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 12);
    const userRows = {};
    for (const [key, u] of Object.entries(USERS)) {
      userRows[key] = await tx.user.create({
        data: {
          name: u.name, email: u.email, password: hashedPassword, role: u.role,
          tenantId: tenant.id, tiendaId: tienda.id, createdAt: TENANT_CREATED_AT,
        },
      });
    }
    const OWNER_ID = userRows.OWNER.id;
    const SELLER_ID = userRows.SELLER.id;
    const TECH_ID = userRows.TECH.id;
    const SELLER_POOL = [OWNER_ID, SELLER_ID]; // quién vende en el POS

    // ── Productos + Inventario ──────────────────────────────────────────
    const productRows = PRODUCTS.map((p, i) => ({
      id: uuid(), name: p.name, color: p.color, storage: p.storage,
      minStock: p.lowStock ? 3 : 0, tenantId: tenant.id, createdAt: TENANT_CREATED_AT,
    }));
    await tx.product.createMany({ data: productRows });

    // "Stock actual": las unidades definidas en PRODUCTS[i].units. Algunas
    // (las últimas de cada producto, salvo las vitrinas de stock bajo)
    // quedan marcadas para vender en los últimos días — el resto queda
    // AVAILABLE hoy.
    const currentStockItems = []; // { id, productId, tiendaId, currencyCode, condition, salePrice, costPrice, sellSoon }
    PRODUCTS.forEach((p, i) => {
      const currency = CURRENCY_CYCLE[i % CURRENCY_CYCLE.length];
      for (let u = 0; u < p.units; u++) {
        const condition = pickWeighted(CONDITION_WEIGHTS);
        const salePrice = priceForCurrency(currency, condition);
        const costPrice = parseFloat((salePrice * randFloat(0.62, 0.80)).toFixed(2));
        currentStockItems.push({
          id: uuid(), productId: productRows[i].id, currencyCode: currency, condition, salePrice, costPrice,
          // solo la primera unidad de productos NO-vitrina es candidata a
          // "vendida hace poco" — nunca las vitrinas (deben seguir con 1
          // unidad disponible para mostrar la alerta).
          sellSoonCandidate: !p.lowStock && u === 0,
        });
      }
    });

    // 9 unidades del stock actual, vendidas en los últimos días (para el
    // relato "algunos productos marcados como vendidos recientemente" sin
    // tocar las 3 vitrinas de stock bajo).
    const sellSoonPool = currentStockItems.filter((it) => it.sellSoonCandidate);
    const recentSoldItems = sellSoonPool.slice(0, 9);
    const recentSoldIds = new Set(recentSoldItems.map((i) => i.id));

    // 30 unidades "históricas" adicionales — ya vendidas a lo largo de todo
    // el período, no forman parte del stock visible hoy. Representan la
    // rotación real de 2 meses de actividad (si no existieran, las primeras
    // 6-7 semanas de caja no tendrían ninguna venta real detrás).
    const HISTORICAL_SOLD_COUNT = 30;
    const historicalItems = [];
    for (let i = 0; i < HISTORICAL_SOLD_COUNT; i++) {
      const productIdx = i % PRODUCTS.length;
      const p = PRODUCTS[productIdx];
      const currency = CURRENCY_CYCLE[productIdx % CURRENCY_CYCLE.length];
      const condition = pickWeighted(CONDITION_WEIGHTS);
      const salePrice = priceForCurrency(currency, condition);
      const costPrice = parseFloat((salePrice * randFloat(0.62, 0.80)).toFixed(2));
      historicalItems.push({
        id: uuid(), productId: productRows[productIdx].id, currencyCode: currency, condition, salePrice, costPrice,
      });
    }

    const allInventoryRows = [
      ...currentStockItems.map((it) => ({
        id: it.id, imei: `VXDEMO-${it.id.slice(0, 8)}`, condition: it.condition,
        status: recentSoldIds.has(it.id) ? 'SOLD' : 'AVAILABLE',
        costPrice: it.costPrice, salePrice: it.salePrice, currencyCode: it.currencyCode,
        accessories: [], productId: it.productId, tenantId: tenant.id, tiendaId: tienda.id,
        createdAt: TENANT_CREATED_AT,
      })),
      ...historicalItems.map((it) => ({
        id: it.id, imei: `VXDEMO-${it.id.slice(0, 8)}`, condition: it.condition, status: 'SOLD',
        costPrice: it.costPrice, salePrice: it.salePrice, currencyCode: it.currencyCode,
        accessories: [], productId: it.productId, tenantId: tenant.id, tiendaId: tienda.id,
        createdAt: TENANT_CREATED_AT,
      })),
    ];
    await tx.inventoryItem.createMany({ data: allInventoryRows });

    // ── Sesiones de caja (una por día activo) ───────────────────────────
    const sessionRows = [];
    const sessionByDayIdx = [];
    for (const day of ACTIVE_DAYS) {
      const id = uuid();
      const openedAt = atTime(day, randInt(9, 10), randInt(0, 59));
      const closedAt = atTime(day, randInt(18, 20), randInt(0, 59));
      sessionRows.push({
        id, openedAt, closedAt, openedById: OWNER_ID, closedById: OWNER_ID,
        tenantId: tenant.id, tiendaId: tienda.id,
      });
      sessionByDayIdx.push({ id, day, openedAt, closedAt });
    }
    await tx.cashSession.createMany({ data: sessionRows });

    // ── LedgerEntry(SESSION_OPEN) — piso de caja en ARS todos los días ──
    const ledgerRows = [];
    const cashMovementRows = [];
    for (const s of sessionByDayIdx) {
      const openingArs = randInt(50, 150) * 1000;
      ledgerRows.push({
        id: uuid(), tenantId: tenant.id, currencyCode: 'ARS', amount: openingArs, type: 'SESSION_OPEN',
        cashSessionId: s.id, description: 'Apertura de caja — saldo inicial ARS',
        createdById: OWNER_ID, createdAt: s.openedAt,
      });
    }

    // ── Ventas: 9 recientes (últimos días activos) + 30 históricas ──────
    const saleRows = [];
    const saleItemRows = [];

    const assignSaleToDay = (item, day) => {
      const session = sessionByDayIdx.find((s) => s.day.toDateString() === day.toDateString());
      const saleId = uuid();
      const saleTime = atTime(day, randInt(10, 19), randInt(0, 59));
      const paymentMethod = pickWeighted([['CASH', 40], ['TRANSFER', 30], ['CARD', 20], ['INSTALLMENTS', 10]]);
      const sellerId = pick(SELLER_POOL);

      saleRows.push({
        id: saleId, total: item.salePrice, paymentMethod, currencyCode: item.currencyCode,
        customerName: chance(0.7) ? randomCustomerName() : null,
        customerPhone: chance(0.7) ? randomPhone() : null,
        sellerId, tenantId: tenant.id, tiendaId: tienda.id, createdAt: saleTime,
      });
      saleItemRows.push({
        id: uuid(), salePrice: item.salePrice, costPrice: item.costPrice,
        originalCurrencyCode: item.currencyCode, originalSalePrice: item.salePrice, originalCostPrice: item.costPrice,
        saleId, inventoryItemId: item.id, createdAt: saleTime,
      });

      if (session) {
        const cashMovementId = uuid();
        cashMovementRows.push({
          id: cashMovementId, type: 'INCOME', amount: item.salePrice, currencyCode: item.currencyCode,
          description: `Venta de 1 equipo`, paymentMethod, sessionId: session.id, saleId,
          createdById: sellerId, tenantId: tenant.id, createdAt: saleTime,
        });
        ledgerRows.push({
          id: uuid(), tenantId: tenant.id, currencyCode: item.currencyCode, amount: item.salePrice, type: 'SALE',
          cashSessionId: session.id, saleId, description: `Venta de 1 equipo`,
          createdById: sellerId, createdAt: saleTime,
        });
      }
    };

    // Últimos 7 días activos → 9 ventas "recientes" (1-2 por día)
    const recentDays = ACTIVE_DAYS.slice(-7);
    let recentIdx = 0;
    for (const day of recentDays) {
      const salesToday = recentIdx < recentSoldItems.length ? (recentIdx === recentDays.length - 1 ? recentSoldItems.length - recentIdx : randInt(1, 2)) : 0;
      for (let k = 0; k < salesToday && recentIdx < recentSoldItems.length; k++) {
        assignSaleToDay(recentSoldItems[recentIdx], day);
        recentIdx++;
      }
    }
    // por si redondeos dejaron alguna sin asignar, se cuelgan del último día activo
    while (recentIdx < recentSoldItems.length) {
      assignSaleToDay(recentSoldItems[recentIdx], ACTIVE_DAYS[ACTIVE_DAYS.length - 1]);
      recentIdx++;
    }

    // Resto de los días activos (todos menos los últimos 7) → 30 ventas históricas
    const historicalDays = ACTIVE_DAYS.slice(0, Math.max(ACTIVE_DAYS.length - 7, 1));
    historicalItems.forEach((item, i) => {
      const day = historicalDays[i % historicalDays.length];
      assignSaleToDay(item, day);
    });

    // ── Movimientos manuales de caja (ingresos/egresos operativos) ──────
    for (const s of sessionByDayIdx) {
      const count = randInt(1, 3);
      for (let k = 0; k < count; k++) {
        const isExpense = chance(0.75);
        const currencyCode = chance(0.82) ? 'ARS' : pick(['USD', 'USDT']);
        const range = currencyCode === 'ARS' ? [8000, 220000] : [15, 250];
        const amount = parseFloat(randFloat(range[0], range[1]).toFixed(2));
        const description = isExpense ? pick(EXPENSE_DESCRIPTIONS) : pick(INCOME_DESCRIPTIONS);
        const paymentMethod = pickWeighted([['CASH', 70], ['TRANSFER', 30]]);
        const movTime = atTime(s.day, randInt(9, 19), randInt(0, 59));

        let exchangeRate = null, appliedRateBase = null;
        if (currencyCode !== 'ARS' && chance(0.4)) {
          appliedRateBase = currencyCode;
          exchangeRate = currencyCode === 'USD' ? usdArsRate(movTime) : usdtArsRate(movTime);
        }

        const cashMovementId = uuid();
        cashMovementRows.push({
          id: cashMovementId, type: isExpense ? 'EXPENSE' : 'INCOME', amount, currencyCode,
          exchangeRate, description, paymentMethod, sessionId: s.id,
          createdById: OWNER_ID, tenantId: tenant.id, createdAt: movTime,
        });
        ledgerRows.push({
          id: uuid(), tenantId: tenant.id, currencyCode,
          amount: isExpense ? -amount : amount,
          type: isExpense ? 'CASH_MOVEMENT_EXPENSE' : 'CASH_MOVEMENT_INCOME',
          appliedRate: exchangeRate, appliedRateBase,
          cashSessionId: s.id, cashMovementId, description,
          createdById: OWNER_ID, createdAt: movTime,
        });
      }
    }

    // ── Ajustes de cierre (descuadres chicos) en algunas sesiones ───────
    const adjustmentDays = [];
    for (let i = 0; i < sessionByDayIdx.length; i += Math.ceil(sessionByDayIdx.length / 5)) {
      adjustmentDays.push(sessionByDayIdx[i]);
    }
    for (const s of adjustmentDays) {
      const diff = parseFloat((pick([-1, 1]) * randFloat(50, 900)).toFixed(2));
      ledgerRows.push({
        id: uuid(), tenantId: tenant.id, currencyCode: 'ARS', amount: diff, type: 'SESSION_CLOSE_ADJUSTMENT',
        cashSessionId: s.id, description: `Ajuste de cierre ARS: diferencia de conteo`,
        createdById: OWNER_ID, createdAt: s.closedAt,
      });
    }

    await tx.sale.createMany({ data: saleRows });
    await tx.saleItem.createMany({ data: saleItemRows });
    // OJO: cashMovementRows/ledgerRows todavía NO se insertan acá — el
    // bloque de proveedores más abajo sigue empujando filas a los mismos
    // arrays (pagos a proveedores desde caja). Se insertan los dos juntos,
    // una sola vez, al final de esta función.

    // ── Proveedores + Órdenes de compra + Pagos ─────────────────────────
    const supplierRows = SUPPLIERS.map((s) => ({
      id: uuid(), name: s.name, city: s.city, paymentDays: s.paymentDays,
      phone: s.phone, email: s.email, tenantId: tenant.id, createdAt: TENANT_CREATED_AT,
    }));
    await tx.supplier.createMany({ data: supplierRows });

    const purchaseOrderRows = [];
    const purchaseOrderItemRows = [];
    const supplierPaymentRows = [];

    const ITEM_DESCRIPTIONS = ['Lote iPhone 11/12 usado grado A', 'Lote iPhone 13 nuevo sellado', 'Lote iPhone 14 refurbished', 'Accesorios varios (fundas/vidrios)', 'Baterías originales x10', 'Lote mixto reacondicionados'];

    SUPPLIERS.forEach((supplierDef, si) => {
      const supplierId = supplierRows[si].id;
      const ordersCount = randInt(2, 3);
      for (let o = 0; o < ordersCount; o++) {
        // Distribuye las órdenes a lo largo del período, más viejas primero.
        const dayIdx = Math.floor(((si * 3 + o) / (SUPPLIERS.length * 3)) * (ACTIVE_DAYS.length - 1));
        const orderDay = ACTIVE_DAYS[Math.min(dayIdx, ACTIVE_DAYS.length - 1)];
        const isLastOrder = o === ordersCount - 1;
        // La última orden de cada proveedor queda PENDING (compra en camino,
        // reciente) — el resto ya se recibió.
        const status = isLastOrder && chance(0.6) ? 'PENDING' : (chance(0.9) ? 'RECEIVED' : 'CANCELLED');

        const itemsCount = randInt(2, 4);
        let total = 0;
        const orderId = uuid();
        for (let it = 0; it < itemsCount; it++) {
          const quantity = randInt(1, 6);
          const unitRange = supplierDef.currency === 'ARS' ? [40000, 220000] : [30, 220];
          const unitPrice = parseFloat(randFloat(unitRange[0], unitRange[1]).toFixed(2));
          total += quantity * unitPrice;
          purchaseOrderItemRows.push({
            id: uuid(), description: pick(ITEM_DESCRIPTIONS), quantity, unitPrice,
            currencyCode: supplierDef.currency, orderId, createdAt: orderDay,
          });
        }
        total = parseFloat(total.toFixed(2));
        const receivedAt = status === 'RECEIVED' ? atTime(orderDay, randInt(11, 17), randInt(0, 59)) : null;

        purchaseOrderRows.push({
          id: orderId, status, total, currencyCode: supplierDef.currency,
          receivedAt, supplierId, tenantId: tenant.id,
          tiendaId: status === 'RECEIVED' ? tienda.id : null,
          createdAt: orderDay,
        });

        if (status === 'RECEIVED') {
          ledgerRows.push({
            id: uuid(), tenantId: tenant.id, currencyCode: supplierDef.currency, amount: -total, type: 'PURCHASE_ORDER',
            purchaseOrderId: orderId,
            description: 'Recepción de orden de compra — deuda generada con el proveedor (pago pendiente, no afecta caja)',
            createdById: OWNER_ID, createdAt: receivedAt,
          });

          // Pago: seña + saldo, mezclando origen (caja del local / cuenta externa)
          const paidAtSeña = atTime(orderDay, randInt(11, 18), randInt(0, 59));
          const señaAmount = parseFloat((total * randFloat(0.35, 0.55)).toFixed(2));
          const saldoAmount = parseFloat((total - señaAmount).toFixed(2));
          const paidAtSaldo = atTime(addDays(orderDay, randInt(3, 12)), randInt(11, 18), randInt(0, 59));

          const registerPayment = (amount, currencyCode, atDate, description) => {
            const useCashRegister = chance(0.5);
            const paymentId = uuid();
            if (useCashRegister) {
              // Necesita una sesión de caja abierta ese día — se busca la más
              // cercana entre los días activos.
              const nearest = sessionByDayIdx.reduce((best, s) =>
                Math.abs(s.day - atDate) < Math.abs(best.day - atDate) ? s : best
              , sessionByDayIdx[0]);
              const cashMovementId = uuid();
              cashMovementRows.push({
                id: cashMovementId, type: 'EXPENSE', amount, currencyCode, description,
                paymentMethod: 'TRANSFER', sessionId: nearest.id,
                createdById: OWNER_ID, tenantId: tenant.id, createdAt: nearest.closedAt,
              });
              ledgerRows.push({
                id: uuid(), tenantId: tenant.id, currencyCode, amount: -amount, type: 'CASH_MOVEMENT_EXPENSE',
                cashSessionId: nearest.id, cashMovementId, description,
                createdById: OWNER_ID, createdAt: nearest.closedAt,
              });
              supplierPaymentRows.push({
                id: paymentId, amount, currencyCode, source: 'CASH_REGISTER',
                purchaseOrderId: orderId, tenantId: tenant.id, tiendaId: tienda.id,
                cashMovementId, paidAt: nearest.closedAt, paidById: OWNER_ID, createdAt: nearest.closedAt,
              });
            } else {
              supplierPaymentRows.push({
                id: paymentId, amount, currencyCode, source: 'EXTERNAL',
                purchaseOrderId: orderId, tenantId: tenant.id, tiendaId: null,
                cashMovementId: null, paidAt: atDate, paidById: OWNER_ID, createdAt: atDate,
              });
              ledgerRows.push({
                id: uuid(), tenantId: tenant.id, currencyCode, amount: -amount, type: 'SUPPLIER_PAYMENT_EXTERNAL',
                supplierPaymentId: paymentId, description,
                createdById: OWNER_ID, createdAt: atDate,
              });
            }
          };

          registerPayment(señaAmount, supplierDef.currency, paidAtSeña, `Seña — orden de compra #${orderId.slice(-6)}`);
          if (paidAtSaldo <= TODAY) {
            registerPayment(saldoAmount, supplierDef.currency, paidAtSaldo, `Pago a proveedor — orden de compra #${orderId.slice(-6)}`);
          }
        } else if (status === 'PENDING' && chance(0.5)) {
          // Seña chica sobre una orden todavía no recibida.
          const señaAmount = parseFloat((total * randFloat(0.15, 0.3)).toFixed(2));
          const paidAt = atTime(orderDay, randInt(11, 18), randInt(0, 59));
          const paymentId = uuid();
          supplierPaymentRows.push({
            id: paymentId, amount: señaAmount, currencyCode: supplierDef.currency, source: 'EXTERNAL',
            purchaseOrderId: orderId, tenantId: tenant.id, tiendaId: null,
            cashMovementId: null, paidAt, paidById: OWNER_ID, createdAt: paidAt,
          });
          ledgerRows.push({
            id: uuid(), tenantId: tenant.id, currencyCode: supplierDef.currency, amount: -señaAmount, type: 'SUPPLIER_PAYMENT_EXTERNAL',
            supplierPaymentId: paymentId, description: `Seña — orden de compra #${orderId.slice(-6)}`,
            createdById: OWNER_ID, createdAt: paidAt,
          });
        }
      }
    });

    await tx.purchaseOrder.createMany({ data: purchaseOrderRows });
    await tx.purchaseOrderItem.createMany({ data: purchaseOrderItemRows });
    // CashMovement de pagos a proveedor se agregó al mismo array de arriba —
    // se inserta ahora junto con el resto (ver más abajo, un solo createMany).

    // ── Reparaciones (13) ────────────────────────────────────────────────
    const REPAIR_STATUS_PLAN = [
      ...Array(3).fill('RECEIVED'),                                  // pendiente
      ...['DIAGNOSING', 'IN_PROGRESS', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'], // en proceso
      ...Array(5).fill('DELIVERED'),                                  // entregada
    ];
    const repairOrderRows = [];
    const repairHistoryRows = [];
    REPAIR_STATUS_PLAN.forEach((status, i) => {
      const dayIdx = Math.floor((i / REPAIR_STATUS_PLAN.length) * (ACTIVE_DAYS.length - 1));
      const createdDay = ACTIVE_DAYS[Math.min(dayIdx, ACTIVE_DAYS.length - 1)];
      const createdAt = atTime(createdDay, randInt(10, 18), randInt(0, 59));
      const faultType = pick(Object.keys(FAULT_DESCRIPTIONS));
      const repairId = uuid();

      let readyAt = null, deliveredAt = null;
      if (['READY', 'DELIVERED'].includes(status)) readyAt = addDays(createdAt, randInt(1, 4));
      if (status === 'DELIVERED') deliveredAt = addDays(readyAt ?? createdAt, randInt(0, 3));
      if (deliveredAt && deliveredAt > TODAY) deliveredAt = TODAY;
      if (readyAt && readyAt > TODAY) readyAt = TODAY;

      repairOrderRows.push({
        id: repairId,
        customerName: randomCustomerName(),
        customerPhone: randomPhone(),
        deviceModel: pick(REPAIR_DEVICE_POOL),
        deviceColor: pick(['Negro', 'Blanco', 'Azul', 'Medianoche', 'Rojo']),
        faultType,
        faultDescription: pick(FAULT_DESCRIPTIONS[faultType]),
        status,
        budget: Math.round(randFloat(15000, 150000) / 500) * 500,
        readyAt, deliveredAt,
        technicianId: chance(0.85) ? TECH_ID : OWNER_ID,
        tenantId: tenant.id,
        createdAt,
      });

      repairHistoryRows.push({
        id: uuid(), status: 'RECEIVED', notes: 'Orden creada', repairId, changedById: TECH_ID, createdAt,
      });
      if (status !== 'RECEIVED') {
        repairHistoryRows.push({
          id: uuid(), status, notes: null, repairId, changedById: TECH_ID,
          createdAt: status === 'DELIVERED' ? deliveredAt : (readyAt ?? addDays(createdAt, 1)),
        });
      }
    });
    await tx.repairOrder.createMany({ data: repairOrderRows });
    await tx.repairStatusHistory.createMany({ data: repairHistoryRows });

    // ── Ahora sí: todos los CashMovement y LedgerEntry juntos ───────────
    await tx.cashMovement.createMany({ data: cashMovementRows });
    await tx.supplierPayment.createMany({ data: supplierPaymentRows });
    await tx.ledgerEntry.createMany({ data: ledgerRows });

    return tenant;
  }, { timeout: 300000, maxWait: 30000 });

  // ── Resumen final — conteos reales desde la DB ──────────────────────────
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  const tenantId = tenant.id;

  const [
    users, tiendas, products, inventoryItems, inventoryAvailable, inventorySold,
    suppliers, purchaseOrders, purchaseOrderItems, supplierPayments,
    repairOrders, cashSessions, cashMovements, sales, ledgerEntries,
  ] = await Promise.all([
    prisma.user.count({ where: { tenantId } }),
    prisma.tienda.count({ where: { tenantId } }),
    prisma.product.count({ where: { tenantId } }),
    prisma.inventoryItem.count({ where: { tenantId } }),
    prisma.inventoryItem.count({ where: { tenantId, status: 'AVAILABLE' } }),
    prisma.inventoryItem.count({ where: { tenantId, status: 'SOLD' } }),
    prisma.supplier.count({ where: { tenantId } }),
    prisma.purchaseOrder.count({ where: { tenantId } }),
    prisma.purchaseOrderItem.count({ where: { order: { tenantId } } }),
    prisma.supplierPayment.count({ where: { tenantId } }),
    prisma.repairOrder.count({ where: { tenantId } }),
    prisma.cashSession.count({ where: { tenantId } }),
    prisma.cashMovement.count({ where: { tenantId } }),
    prisma.sale.count({ where: { tenantId } }),
    prisma.ledgerEntry.count({ where: { tenantId } }),
  ]);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ${DEMO_NAME} — dataset listo (tenant ${tenantId})`);
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Creado (fecha simulada):  ${TENANT_CREATED_AT.toLocaleDateString('es-AR')}`);
  console.log(`  Sucursales:               ${tiendas}`);
  console.log(`  Usuarios:                 ${users}`);
  console.log(`  Productos (catálogo):     ${products}`);
  console.log(`  Unidades de inventario:   ${inventoryItems}  (disponibles: ${inventoryAvailable}, vendidas: ${inventorySold})`);
  console.log(`  Ventas:                   ${sales}`);
  console.log(`  Sesiones de caja:         ${cashSessions}`);
  console.log(`  Movimientos de caja:      ${cashMovements}`);
  console.log(`  Asientos de ledger:       ${ledgerEntries}`);
  console.log(`  Proveedores:              ${suppliers}`);
  console.log(`  Órdenes de compra:        ${purchaseOrders}  (líneas: ${purchaseOrderItems})`);
  console.log(`  Pagos a proveedores:      ${supplierPayments}`);
  console.log(`  Reparaciones:             ${repairOrders}`);
  console.log('───────────────────────────────────────────────────────');
  console.log('  Login (cualquiera de los 3):');
  for (const u of Object.values(USERS)) {
    console.log(`    ${u.role.padEnd(6)} — ${u.email}  /  ${DEMO_PASSWORD}`);
  }
  console.log('═══════════════════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('[seed-demo] ERROR:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
