/**
 * Dataset de demo para grabar un Loom — tenant "iPhonería".
 *
 * A diferencia de seed-demo.js (1 sucursal, ~2 meses), este arma un tenant
 * MULTISUCURSAL con ~2 semanas de actividad distribuida día a día, pensado
 * para mostrar en vivo: nav por rol, cambio de sucursal, transferencias,
 * modelo pull de reparaciones + thread de comentarios, y notificaciones.
 *
 * Determinístico (PRNG con seed fija) — dos corridas producen el mismo
 * dataset. SIEMPRE borra por completo el tenant demo anterior (identificado
 * por DEMO_SLUG, nunca por nombre) antes de recrearlo: nunca duplica, nunca
 * toca otro tenant.
 *
 * Uso:  node seed-loom.js     (desde vexio-backend/, o dentro del contenedor)
 *       npm run seed:loom
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();

// ─── Identidad del tenant demo ─────────────────────────────────────────────

const DEMO_SLUG = 'iphoneria-loom';
const DEMO_NAME = 'iPhonería';
const DEMO_TENANT_EMAIL = 'hola@iphoneria.com.ar';
const DEMO_PASSWORD = 'Demo2026!';

const TIENDAS = [
  { key: 'CENTRO',  name: 'Centro',  address: 'Av. Corrientes 1234, CABA' },
  { key: 'PALERMO', name: 'Palermo', address: 'Av. Santa Fe 3890, CABA' },
];

const USERS = [
  { key: 'OWNER',        name: 'Martín Aguirre', email: 'martin@iphoneria.com.ar', role: 'OWNER',  tienda: null },
  { key: 'SELLER_CENTRO',name: 'Carla Ríos',     email: 'carla@iphoneria.com.ar',  role: 'SELLER', tienda: 'CENTRO' },
  { key: 'SELLER_PALERMO',name: 'Julián Ortiz',  email: 'julian@iphoneria.com.ar', role: 'SELLER', tienda: 'PALERMO' },
  { key: 'TECH',         name: 'Lucas Medina',   email: 'lucas@iphoneria.com.ar',  role: 'TECH',   tienda: null },
];

// ─── PRNG determinístico (mulberry32) ─────────────────────────────────────

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260923);
const chance = (p) => rand() < p;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickWeighted = (weighted) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of weighted) if ((r -= w) <= 0) return value;
  return weighted[weighted.length - 1][0];
};
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randFloat = (min, max) => rand() * (max - min) + min;
const uuid = () => crypto.randomUUID();

// ─── Fechas ───────────────────────────────────────────────────────────────

// TODO en hora Argentina (UTC-3, sin horario de verano). El contenedor de
// Railway corre en UTC, así que construimos los instantes con Date.UTC(h+3)
// para que la hora de pared que se ve en la app sea la argentina, corra donde
// corra el script.
const AR = 3;
const arInstant = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo, d, h + AR, mi, 0, 0));
const arYMD = (date) => {
  const s = new Date(date.getTime() - AR * 3600e3);
  return [s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), s.getUTCDay()];
};

const NOW = new Date();
const [_ty, _tm, _td] = arYMD(NOW);
const TODAY = arInstant(_ty, _tm, _td, 0, 0); // medianoche AR de hoy

const addDays  = (date, n) => new Date(date.getTime() + n * 86400e3);
const addHours = (date, n) => new Date(date.getTime() + n * 3600e3);
// atTime(díaAR, h, m): reloj a h:m hora Argentina de ese día calendario.
const atTime = (arDay, h, m) => { const [y, mo, d] = arYMD(arDay); return arInstant(y, mo, d, h, m); };
const clampNow = (d) => (d && d.getTime() > NOW.getTime() ? NOW : d);
const NOW_AR_H = new Date(NOW.getTime() - AR * 3600e3).getUTCHours();
// hora aleatoria [lo,hi]; si `day` es HOY, no pasa de la hora actual (AR).
const dayHour = (day, lo, hi) => randInt(lo, day.getTime() === TODAY.getTime() ? Math.max(lo, Math.min(hi, NOW_AR_H)) : hi);

const WINDOW_START = addDays(TODAY, -13); // 14 días contando hoy

// Días activos: se saltea domingo (hora AR), y ~12% de los demás.
const ACTIVE_DAYS = [];
for (let ms = WINDOW_START.getTime(); ms <= TODAY.getTime(); ms += 86400e3) {
  const day = new Date(ms);
  if (arYMD(day)[3] === 0) continue; // domingo
  if (!chance(0.88)) continue;
  ACTIVE_DAYS.push(day);
}
// Garantía: HOY siempre es día activo (cajas abiertas / pool fresco).
if (!ACTIVE_DAYS.length || ACTIVE_DAYS[ACTIVE_DAYS.length - 1].getTime() !== TODAY.getTime()) {
  ACTIVE_DAYS.push(TODAY);
}
const LAST_DAY = ACTIVE_DAYS[ACTIVE_DAYS.length - 1];

// ─── Tasas simuladas ──────────────────────────────────────────────────────

const usdArsRate = (date) => {
  const t = (date - WINDOW_START) / (TODAY - WINDOW_START || 1);
  return parseFloat(((1230 + t * 40) * (1 + randFloat(-0.005, 0.005))).toFixed(2));
};
const usdtArsRate = (date) => {
  const t = (date - WINDOW_START) / (TODAY - WINDOW_START || 1);
  return parseFloat(((1222 + t * 38) * (1 + randFloat(-0.005, 0.005))).toFixed(2));
};

// ─── Catálogo ─────────────────────────────────────────────────────────────
// centro / palermo = unidades que arrancan en cada sucursal. lowStock => el
// producto queda con 1 sola unidad disponible y minStock 3 (dispara alerta).

const PRODUCTS = [
  { name: 'iPhone 11',         color: 'Negro',          storage: '64GB',  centro: 3, palermo: 2 },
  { name: 'iPhone 11',         color: 'Blanco',         storage: '128GB', centro: 2, palermo: 3 },
  { name: 'iPhone 12',         color: 'Azul',           storage: '64GB',  centro: 3, palermo: 3 },
  { name: 'iPhone 12',         color: 'Negro',          storage: '128GB', centro: 4, palermo: 2 },
  { name: 'iPhone 12 Pro',     color: 'Grafito',        storage: '128GB', centro: 1, palermo: 1, lowStock: true },
  { name: 'iPhone 13',         color: 'Medianoche',     storage: '128GB', centro: 4, palermo: 3 },
  { name: 'iPhone 13',         color: 'Rosa',           storage: '128GB', centro: 3, palermo: 2 },
  { name: 'iPhone 13 Pro',     color: 'Azul Sierra',    storage: '256GB', centro: 3, palermo: 2 },
  { name: 'iPhone 13 Pro Max', color: 'Grafito',        storage: '256GB', centro: 1, palermo: 1, lowStock: true },
  { name: 'iPhone 14',         color: 'Medianoche',     storage: '128GB', centro: 4, palermo: 4 },
  { name: 'iPhone 14',         color: 'Púrpura',        storage: '256GB', centro: 3, palermo: 2 },
  { name: 'iPhone 14 Plus',    color: 'Azul',           storage: '128GB', centro: 2, palermo: 3 },
  { name: 'iPhone 14 Pro',     color: 'Negro Espacial', storage: '256GB', centro: 3, palermo: 3 },
  { name: 'iPhone 14 Pro Max', color: 'Plata',          storage: '256GB', centro: 1, palermo: 1, lowStock: true },
  { name: 'iPhone 15',         color: 'Negro',          storage: '128GB', centro: 3, palermo: 3 },
  { name: 'iPhone 15',         color: 'Rosa',           storage: '256GB', centro: 2, palermo: 2 },
  { name: 'iPhone 15 Pro',     color: 'Titanio Natural',storage: '256GB', centro: 2, palermo: 3 },
  { name: 'iPhone 15 Pro Max', color: 'Titanio Azul',   storage: '512GB', centro: 1, palermo: 2 },
];

const CURRENCY_CYCLE = ['ARS', 'USD', 'USDT', 'ARS', 'USDT', 'USD', 'ARS', 'USDT', 'USD', 'ARS'];
const PRICE_RANGES = { ARS: { min: 480000, max: 1650000 }, USD: { min: 380, max: 1500 }, USDT: { min: 380, max: 1500 } };
const CONDITION_WINDOW = { NEW: [0.7, 1.0], LIKE_NEW: [0.55, 0.85], REFURBISHED: [0.4, 0.7], USED: [0.3, 0.58] };
const CONDITION_WEIGHTS = [['NEW', 30], ['LIKE_NEW', 32], ['REFURBISHED', 22], ['USED', 16]];
const priceForCurrency = (cur, cond) => {
  const { min, max } = PRICE_RANGES[cur];
  const [lo, hi] = CONDITION_WINDOW[cond];
  return parseFloat((min + randFloat(lo, hi) * (max - min)).toFixed(2));
};

const EXPENSE_DESCRIPTIONS = [
  'Pago de alquiler del local', 'Servicio de internet y telefonía', 'Pago de luz',
  'Compra de fundas y vidrios templados', 'Comisión Mercado Pago', 'Viáticos — retiro de mercadería',
  'Compra de insumos de reparación', 'Publicidad en Instagram', 'Café y limpieza',
];
const INCOME_DESCRIPTIONS = ['Venta de accesorio suelto', 'Seña por equipo reservado (WhatsApp)', 'Aporte de caja chica'];

const SUPPLIERS = [
  { name: 'ImportCel SRL',       city: 'CABA',    paymentDays: 30, phone: '11-4555-2231', email: 'ventas@importcel.com.ar', currency: 'USD' },
  { name: 'MegaPhone Mayorista', city: 'Córdoba', paymentDays: 15, phone: '351-455-9021', email: 'pedidos@megaphone.com.ar', currency: 'USDT' },
  { name: 'Distribuidora Trade', city: 'CABA',    paymentDays: 45, phone: '11-3220-8890', email: 'compras@distritrade.com.ar', currency: 'ARS' },
];

const FAULT_DESCRIPTIONS = {
  SCREEN:   ['Pantalla rota con manchas de tinta', 'Táctil no responde en el borde inferior', 'Pantalla con líneas verticales'],
  BATTERY:  ['Batería se descarga muy rápido', 'Se apaga solo al 20%', 'Salud de batería al 71%'],
  CHARGING: ['No carga salvo moviendo el cable', 'Puerto de carga flojo', 'Carga muy lento'],
  CAMERA:   ['Cámara trasera desenfocada', 'Cámara frontal no abre', 'Vidrio de cámara rajado'],
  SPEAKER:  ['No se escucha en llamadas', 'Parlante inferior con distorsión'],
  WATER:    ['Cayó al inodoro, prende pero pantalla parpadea', 'Contacto con humedad, no da señal'],
  SOFTWARE: ['Reinicios aleatorios', 'Bloqueado en logo de la manzana'],
  BUTTON:   ['Botón de volumen trabado', 'Botón lateral no responde'],
};
const REPAIR_DEVICE_POOL = ['iPhone 11', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 13', 'iPhone 13 Pro Max', 'iPhone 14', 'iPhone 14 Pro'];
const FIRST = ['Juan', 'Sofía', 'Mateo', 'Valentina', 'Lucas', 'Camila', 'Tomás', 'Julieta', 'Bruno', 'Agustina', 'Franco', 'Micaela', 'Ignacio', 'Renata', 'Nahuel', 'Paula'];
const LAST = ['González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Díaz', 'Romero', 'Sosa', 'Torres', 'Acosta', 'Benítez', 'Molina', 'Silva', 'Herrera'];
const custName = () => `${pick(FIRST)} ${pick(LAST)}`;
const custPhone = () => `11-${randInt(3000, 6999)}-${randInt(1000, 9999)}`;

// ─── Borrado del tenant demo anterior ────────────────────────────────────

async function wipe(tx, tenantId) {
  await tx.ledgerEntry.deleteMany({ where: { tenantId } });
  await tx.conversion.deleteMany({ where: { tenantId } });
  await tx.supplierPayment.deleteMany({ where: { tenantId } });
  await tx.cashMovement.deleteMany({ where: { tenantId } });
  await tx.saleItem.deleteMany({ where: { sale: { tenantId } } });
  await tx.sale.deleteMany({ where: { tenantId } });
  await tx.cashSession.deleteMany({ where: { tenantId } });
  await tx.purchaseOrderItem.deleteMany({ where: { order: { tenantId } } });
  await tx.purchaseOrder.deleteMany({ where: { tenantId } });
  await tx.payment.deleteMany({ where: { tenantId } });
  await tx.repairComment.deleteMany({ where: { repair: { tenantId } } });
  await tx.repairStatusHistory.deleteMany({ where: { repair: { tenantId } } });
  await tx.repairOrder.deleteMany({ where: { tenantId } });
  await tx.customer.deleteMany({ where: { tenantId } });
  await tx.stockTransferItem.deleteMany({ where: { transfer: { tenantId } } });
  await tx.inventoryItem.deleteMany({ where: { tenantId } });
  await tx.stockTransfer.deleteMany({ where: { tenantId } });
  await tx.delivery.deleteMany({ where: { tenantId } });
  await tx.product.deleteMany({ where: { tenantId } });
  await tx.supplier.deleteMany({ where: { tenantId } });
  await tx.notification.deleteMany({ where: { tenantId } });
  await tx.ticketReply.deleteMany({ where: { ticket: { tenantId } } });
  await tx.supportTicket.deleteMany({ where: { tenantId } });
  await tx.refreshToken.deleteMany({ where: { user: { tenantId } } });
  await tx.user.deleteMany({ where: { tenantId } });
  await tx.tienda.deleteMany({ where: { tenantId } });
  await tx.tenant.delete({ where: { id: tenantId } });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  for (const c of [
    { code: 'ARS', name: 'Peso Argentino', symbol: '$' },
    { code: 'USD', name: 'Dólar Estadounidense', symbol: 'US$' },
    { code: 'USDT', name: 'Tether (USDT)', symbol: '₮' },
  ]) await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });

  const superadmin = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' }, select: { id: true, name: true } });

  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing) {
    console.log(`[seed-loom] Borrando tenant demo previo (${existing.id})...`);
    await prisma.$transaction((tx) => wipe(tx, existing.id), { timeout: 120000 });
  }

  console.log('[seed-loom] Generando dataset...');

  await prisma.$transaction(async (tx) => {
    // ── Tenant + Sucursales + Usuarios ────────────────────────────────────
    const tenant = await tx.tenant.create({
      data: {
        name: DEMO_NAME, slug: DEMO_SLUG, email: DEMO_TENANT_EMAIL, status: 'ACTIVE', plan: 'FULL',
        activeModules: ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties', 'whatsapp', 'reports', 'multibranch'],
        maxUsers: 12, createdAt: WINDOW_START,
      },
    });

    const T = {};
    for (const t of TIENDAS) {
      T[t.key] = await tx.tienda.create({ data: { name: t.name, address: t.address, tenantId: tenant.id, createdAt: WINDOW_START } });
    }

    const hashed = await bcrypt.hash(DEMO_PASSWORD, 12);
    const U = {};
    for (const u of USERS) {
      U[u.key] = await tx.user.create({
        data: {
          name: u.name, email: u.email, password: hashed, role: u.role, tenantId: tenant.id,
          tiendaId: u.tienda ? T[u.tienda].id : null, createdAt: WINDOW_START,
        },
      });
    }
    const sellerOf = { [T.CENTRO.id]: U.SELLER_CENTRO.id, [T.PALERMO.id]: U.SELLER_PALERMO.id };

    // ── Productos + Inventario ───────────────────────────────────────────
    const productRows = PRODUCTS.map((p) => ({
      id: uuid(), name: p.name, color: p.color, storage: p.storage,
      minStock: p.lowStock ? 3 : 0, tenantId: tenant.id, createdAt: WINDOW_START,
    }));
    await tx.product.createMany({ data: productRows });

    // items: { id, productId, tiendaId, currencyCode, condition, salePrice, costPrice, model, sellCandidate }
    const items = [];
    let cyc = 0;
    PRODUCTS.forEach((p, i) => {
      const perTienda = [[T.CENTRO.id, p.centro], [T.PALERMO.id, p.palermo]];
      perTienda.forEach(([tiendaId, count]) => {
        for (let u = 0; u < count; u++) {
          const currency = CURRENCY_CYCLE[cyc++ % CURRENCY_CYCLE.length];
          const condition = pickWeighted(CONDITION_WEIGHTS);
          const salePrice = priceForCurrency(currency, condition);
          const costPrice = parseFloat((salePrice * randFloat(0.6, 0.8)).toFixed(2));
          items.push({
            id: uuid(), productId: productRows[i].id, tiendaId, currencyCode: currency, condition,
            salePrice, costPrice, model: p.name,
            // productos lowStock: NUNCA se venden (deben quedar con 1 unidad visible)
            sellCandidate: !p.lowStock,
          });
        }
      });
    });

    // Reparto: ~35% del stock vendible se vende en las 2 semanas; el resto
    // queda AVAILABLE hoy. Algunas unidades van a transferencias.
    const sellable = items.filter((it) => it.sellCandidate);
    // ~50% del stock vendible se vende — elegido por PRNG (determinístico con la
    // seed fija) y NO por índice, para no correlacionar con el ciclo de moneda.
    const soldItems = sellable.filter(() => chance(0.52));
    const soldIds = new Set(soldItems.map((it) => it.id));

    // 5 unidades para transferencias (de las NO vendidas)
    const freeForTransfer = items.filter((it) => !soldIds.has(it.id) && it.sellCandidate);
    const trItems = {
      closed:     [freeForTransfer[0], freeForTransfer[1]],   // Centro -> Palermo, recibida
      dispatched: [freeForTransfer[2], freeForTransfer[3]],   // Palermo -> Centro, en camino
      open:       [freeForTransfer[4]],                        // Centro -> Palermo, en armado
    };
    const inTransferPreparing = new Set(trItems.open.map((it) => it.id));
    const inTransferDispatched = new Set(trItems.dispatched.map((it) => it.id));

    // ── Delivery (fleteros) ─────────────────────────────────────────────
    const delivery1 = await tx.delivery.create({ data: { name: 'Fletes Kangoo', phone: '11-5566-7788', tenantId: tenant.id, createdAt: WINDOW_START } });
    const delivery2 = await tx.delivery.create({ data: { name: 'Moto Mensajería CABA', phone: '11-4433-2211', tenantId: tenant.id, createdAt: WINDOW_START } });

    // ── Transferencias ─────────────────────────────────────────────────
    // 1) CLOSED: Centro -> Palermo, despachada hace 6d, recibida hace 5d.
    const trClosedId = uuid();
    const trClosedDispatch = atTime(addDays(TODAY, -6), 16, 20);
    const trClosedReceive = atTime(addDays(TODAY, -5), 11, 5);
    await tx.stockTransfer.create({
      data: {
        id: trClosedId, status: 'CLOSED', tenantId: tenant.id,
        fromTiendaId: T.CENTRO.id, toTiendaId: T.PALERMO.id, deliveryId: delivery1.id,
        createdById: U.SELLER_CENTRO.id, dispatchedById: U.SELLER_CENTRO.id, dispatchedAt: trClosedDispatch,
        closedAt: trClosedReceive, notes: 'Reposición de iPhone 13/14 para Palermo',
        createdAt: atTime(addDays(TODAY, -6), 15, 0),
      },
    });

    // 2) DISPATCHED: Palermo -> Centro, despachada hace 2d, sin recibir.
    const trDispId = uuid();
    const trDispDispatch = atTime(addDays(TODAY, -2), 17, 40);
    await tx.stockTransfer.create({
      data: {
        id: trDispId, status: 'DISPATCHED', tenantId: tenant.id,
        fromTiendaId: T.PALERMO.id, toTiendaId: T.CENTRO.id, deliveryId: delivery2.id,
        createdById: U.SELLER_PALERMO.id, dispatchedById: U.SELLER_PALERMO.id, dispatchedAt: trDispDispatch,
        notes: 'Centro necesita stock para el fin de semana',
        createdAt: atTime(addDays(TODAY, -2), 16, 30),
      },
    });

    // 3) OPEN: Centro -> Palermo, en armado (agregada ayer).
    const trOpenId = uuid();
    await tx.stockTransfer.create({
      data: {
        id: trOpenId, status: 'OPEN', tenantId: tenant.id,
        fromTiendaId: T.CENTRO.id, toTiendaId: T.PALERMO.id,
        createdById: U.SELLER_CENTRO.id, notes: null,
        createdAt: atTime(addDays(TODAY, -1), 12, 0),
      },
    });

    // ── Inventario: filas finales ──────────────────────────────────────
    const invRows = items.map((it) => {
      let status = 'AVAILABLE';
      let tiendaId = it.tiendaId;
      let currentTransferId = null;

      if (soldIds.has(it.id)) status = 'SOLD';
      else if (inTransferPreparing.has(it.id)) { status = 'IN_TRANSIT'; currentTransferId = trOpenId; }
      else if (inTransferDispatched.has(it.id)) { status = 'IN_TRANSIT'; currentTransferId = trDispId; }
      else if (trItems.closed.some((c) => c.id === it.id)) { tiendaId = T.PALERMO.id; } // ya recibida en destino

      return {
        id: it.id, imei: `IPH-${it.id.slice(0, 6).toUpperCase()}`, condition: it.condition, status,
        costPrice: it.costPrice, salePrice: it.salePrice, currencyCode: it.currencyCode, accessories: [],
        productId: it.productId, tenantId: tenant.id, tiendaId, currentTransferId, createdAt: WINDOW_START,
      };
    });
    await tx.inventoryItem.createMany({ data: invRows });

    // StockTransferItem para cada transferencia
    const stiRows = [
      ...trItems.closed.map((it) => ({
        id: uuid(), status: 'RECEIVED', transferId: trClosedId, inventoryItemId: it.id,
        addedById: U.SELLER_CENTRO.id, receivedById: U.SELLER_PALERMO.id, receivedAt: trClosedReceive,
        createdAt: atTime(addDays(TODAY, -6), 15, 10),
      })),
      ...trItems.dispatched.map((it) => ({
        id: uuid(), status: 'DISPATCHED', transferId: trDispId, inventoryItemId: it.id,
        addedById: U.SELLER_PALERMO.id, createdAt: atTime(addDays(TODAY, -2), 16, 35),
      })),
      ...trItems.open.map((it) => ({
        id: uuid(), status: 'PREPARING', transferId: trOpenId, inventoryItemId: it.id,
        addedById: U.SELLER_CENTRO.id, createdAt: atTime(addDays(TODAY, -1), 12, 5),
      })),
    ];
    await tx.stockTransferItem.createMany({ data: stiRows });

    // ── Cajas: una sesión por (día activo × sucursal) ──────────────────
    const sessions = []; // { id, tiendaId, day, openedAt, closedAt|null }
    for (const day of ACTIVE_DAYS) {
      const isToday = day.getTime() === TODAY.getTime();
      for (const tiendaId of [T.CENTRO.id, T.PALERMO.id]) {
        const id = uuid();
        const openedAt = clampNow(atTime(day, dayHour(day, 9, 10), randInt(0, 59)));
        const closedAt = isToday ? null : atTime(day, randInt(19, 20), randInt(0, 59));
        sessions.push({ id, tiendaId, day, openedAt, closedAt });
      }
    }
    await tx.cashSession.createMany({
      data: sessions.map((s) => ({
        id: s.id, tenantId: tenant.id, tiendaId: s.tiendaId, openedById: sellerOf[s.tiendaId],
        closedById: s.closedAt ? sellerOf[s.tiendaId] : null, openedAt: s.openedAt, closedAt: s.closedAt,
      })),
    });
    const sessionFor = (tiendaId, day) => sessions.find((s) => s.tiendaId === tiendaId && s.day.getTime() === day.getTime());

    const ledgerRows = [];
    const cashMovementRows = [];

    // SESSION_OPEN (piso ARS) por sesión
    for (const s of sessions) {
      ledgerRows.push({
        id: uuid(), tenantId: tenant.id, currencyCode: 'ARS', amount: randInt(40, 120) * 1000, type: 'SESSION_OPEN',
        cashSessionId: s.id, description: 'Apertura de caja — saldo inicial ARS',
        createdById: sellerOf[s.tiendaId], createdAt: s.openedAt,
      });
    }

    // ── Ventas: repartidas por día activo y sucursal ──────────────────
    const saleRows = [];
    const saleItemRows = [];
    const sellQueue = { [T.CENTRO.id]: [], [T.PALERMO.id]: [] };
    for (const it of soldItems) sellQueue[it.tiendaId].push(it);

    // objetivo fijo de ventas/día/sucursal (para que ningún día quede vacío
    // ni sobrecargado) ≈ total / días activos.
    const perDayBase = {
      [T.CENTRO.id]: Math.max(1, Math.round(sellQueue[T.CENTRO.id].length / ACTIVE_DAYS.length)),
      [T.PALERMO.id]: Math.max(1, Math.round(sellQueue[T.PALERMO.id].length / ACTIVE_DAYS.length)),
    };
    for (const day of ACTIVE_DAYS) {
      for (const tiendaId of [T.CENTRO.id, T.PALERMO.id]) {
        const q = sellQueue[tiendaId];
        if (!q.length) continue;
        const n = Math.min(q.length, Math.max(0, perDayBase[tiendaId] + randInt(-1, 2)));
        for (let k = 0; k < n; k++) {
          const it = q.shift();
          const saleId = uuid();
          const saleTime = atTime(day, dayHour(day, 10, 19), randInt(5, 55));
          const paymentMethod = pickWeighted([['CASH', 38], ['TRANSFER', 30], ['CARD', 20], ['INSTALLMENTS', 12]]);
          const sellerId = chance(0.8) ? sellerOf[tiendaId] : U.OWNER.id;
          const session = sessionFor(tiendaId, day);
          const isFx = it.currencyCode !== 'ARS';
          const exchangeRate = isFx ? (it.currencyCode === 'USD' ? usdArsRate(saleTime) : usdtArsRate(saleTime)) : null;

          saleRows.push({
            id: saleId, total: it.salePrice, paymentMethod, currencyCode: it.currencyCode,
            customerName: chance(0.75) ? custName() : null, customerPhone: chance(0.6) ? custPhone() : null,
            exchangeRate, sellerId, tenantId: tenant.id, tiendaId, createdAt: saleTime,
          });
          saleItemRows.push({
            id: uuid(), salePrice: it.salePrice, costPrice: it.costPrice,
            originalCurrencyCode: it.currencyCode, originalSalePrice: it.salePrice, originalCostPrice: it.costPrice,
            saleId, inventoryItemId: it.id, createdAt: saleTime,
          });
          if (session) {
            const cmId = uuid();
            cashMovementRows.push({
              id: cmId, type: 'INCOME', amount: it.salePrice, currencyCode: it.currencyCode,
              description: `Venta ${it.model}`, paymentMethod, sessionId: session.id, saleId,
              createdById: sellerId, tenantId: tenant.id, createdAt: saleTime,
            });
            ledgerRows.push({
              id: uuid(), tenantId: tenant.id, currencyCode: it.currencyCode, amount: it.salePrice, type: 'SALE',
              cashSessionId: session.id, saleId, description: `Venta ${it.model}`,
              createdById: sellerId, createdAt: saleTime,
            });
          }
        }
      }
    }
    // lo que sobró en la cola (por randInt(0,..)=0 varios días) — colgar del último día
    for (const tiendaId of [T.CENTRO.id, T.PALERMO.id]) {
      for (const it of sellQueue[tiendaId]) {
        const saleId = uuid();
        const saleTime = atTime(LAST_DAY, dayHour(LAST_DAY, 11, 18), randInt(0, 59));
        const session = sessionFor(tiendaId, LAST_DAY);
        const paymentMethod = pickWeighted([['CASH', 40], ['TRANSFER', 35], ['CARD', 25]]);
        const sellerId = sellerOf[tiendaId];
        const lfx = it.currencyCode === 'ARS' ? null : (it.currencyCode === 'USD' ? usdArsRate(saleTime) : usdtArsRate(saleTime));
        saleRows.push({
          id: saleId, total: it.salePrice, paymentMethod, currencyCode: it.currencyCode,
          customerName: custName(), customerPhone: chance(0.5) ? custPhone() : null,
          exchangeRate: lfx,
          sellerId, tenantId: tenant.id, tiendaId, createdAt: saleTime,
        });
        saleItemRows.push({
          id: uuid(), salePrice: it.salePrice, costPrice: it.costPrice,
          originalCurrencyCode: it.currencyCode, originalSalePrice: it.salePrice, originalCostPrice: it.costPrice,
          saleId, inventoryItemId: it.id, createdAt: saleTime,
        });
        if (session) {
          const cmId = uuid();
          cashMovementRows.push({
            id: cmId, type: 'INCOME', amount: it.salePrice, currencyCode: it.currencyCode,
            description: `Venta ${it.model}`, paymentMethod, sessionId: session.id, saleId,
            createdById: sellerId, tenantId: tenant.id, createdAt: saleTime,
          });
          ledgerRows.push({
            id: uuid(), tenantId: tenant.id, currencyCode: it.currencyCode, amount: it.salePrice, type: 'SALE',
            cashSessionId: session.id, saleId, description: `Venta ${it.model}`, createdById: sellerId, createdAt: saleTime,
          });
        }
      }
    }

    // ── Movimientos manuales de caja ──────────────────────────────────
    for (const s of sessions) {
      const count = randInt(0, 2);
      for (let k = 0; k < count; k++) {
        const isExpense = chance(0.78);
        const currencyCode = chance(0.85) ? 'ARS' : pick(['USD', 'USDT']);
        const range = currencyCode === 'ARS' ? [6000, 180000] : [10, 200];
        const amount = parseFloat(randFloat(range[0], range[1]).toFixed(2));
        const description = isExpense ? pick(EXPENSE_DESCRIPTIONS) : pick(INCOME_DESCRIPTIONS);
        const paymentMethod = pickWeighted([['CASH', 70], ['TRANSFER', 30]]);
        const movTime = atTime(s.day, dayHour(s.day, 10, 18), randInt(0, 59));
        const cmId = uuid();
        cashMovementRows.push({
          id: cmId, type: isExpense ? 'EXPENSE' : 'INCOME', amount, currencyCode, description,
          paymentMethod, sessionId: s.id, createdById: sellerOf[s.tiendaId], tenantId: tenant.id, createdAt: movTime,
        });
        ledgerRows.push({
          id: uuid(), tenantId: tenant.id, currencyCode, amount: isExpense ? -amount : amount,
          type: isExpense ? 'CASH_MOVEMENT_EXPENSE' : 'CASH_MOVEMENT_INCOME',
          cashSessionId: s.id, cashMovementId: cmId, description,
          createdById: sellerOf[s.tiendaId], createdAt: movTime,
        });
      }
    }

    // ── Ajustes de cierre en algunas sesiones cerradas ────────────────
    sessions.filter((s) => s.closedAt).forEach((s, idx) => {
      if (idx % 4 !== 0) return;
      const diff = parseFloat((pick([-1, 1]) * randFloat(80, 1200)).toFixed(2));
      ledgerRows.push({
        id: uuid(), tenantId: tenant.id, currencyCode: 'ARS', amount: diff, type: 'SESSION_CLOSE_ADJUSTMENT',
        cashSessionId: s.id, description: 'Ajuste de cierre ARS: diferencia de conteo',
        createdById: sellerOf[s.tiendaId], createdAt: s.closedAt,
      });
    });

    await tx.sale.createMany({ data: saleRows });
    await tx.saleItem.createMany({ data: saleItemRows });

    // ── Proveedores + Órdenes + Pagos ────────────────────────────────
    const supplierRows = SUPPLIERS.map((s) => ({
      id: uuid(), name: s.name, city: s.city, paymentDays: s.paymentDays, phone: s.phone, email: s.email,
      tenantId: tenant.id, createdAt: WINDOW_START,
    }));
    await tx.supplier.createMany({ data: supplierRows });

    const poRows = [];
    const poItemRows = [];
    const supplierPaymentRows = [];
    const ITEM_DESC = ['Lote iPhone 12/13 usado grado A', 'Lote iPhone 14 sellado', 'Lote iPhone 15 refurbished', 'Accesorios varios (fundas/vidrios)', 'Baterías originales x10'];

    SUPPLIERS.forEach((sd, si) => {
      const supplierId = supplierRows[si].id;
      const ordersCount = si === 0 ? 2 : 1;
      for (let o = 0; o < ordersCount; o++) {
        const orderDay = ACTIVE_DAYS[Math.min(Math.floor(((si + o) / (SUPPLIERS.length + 1)) * ACTIVE_DAYS.length), ACTIVE_DAYS.length - 1)];
        const status = (si === 0 && o === 1) ? 'PENDING' : 'RECEIVED'; // la 2da de ImportCel queda en camino
        const itemsCount = randInt(2, 3);
        const orderId = uuid();
        let total = 0;
        for (let it = 0; it < itemsCount; it++) {
          const quantity = randInt(1, 5);
          const unitRange = sd.currency === 'ARS' ? [45000, 240000] : [35, 240];
          const unitPrice = parseFloat(randFloat(unitRange[0], unitRange[1]).toFixed(2));
          total += quantity * unitPrice;
          poItemRows.push({ id: uuid(), description: pick(ITEM_DESC), quantity, unitPrice, currencyCode: sd.currency, orderId, createdAt: orderDay });
        }
        total = parseFloat(total.toFixed(2));
        // La orden nace atada a la sucursal activa de quien la carga (createOrder
        // estampa tiendaId al crear, PENDING o RECEIVED — ver suppliers.controller).
        const orderTienda = (si + o) % 2 === 0 ? T.CENTRO.id : T.PALERMO.id;
        const receivedAt = status === 'RECEIVED' ? atTime(orderDay, randInt(12, 17), randInt(0, 59)) : null;
        poRows.push({
          id: orderId, status, total, currencyCode: sd.currency, receivedAt, supplierId, tenantId: tenant.id,
          tiendaId: orderTienda, createdAt: orderDay,
        });

        if (status === 'RECEIVED') {
          ledgerRows.push({
            id: uuid(), tenantId: tenant.id, currencyCode: sd.currency, amount: -total, type: 'PURCHASE_ORDER',
            purchaseOrderId: orderId, description: 'Recepción de orden de compra — deuda con proveedor',
            createdById: U.OWNER.id, createdAt: receivedAt,
          });
          // un pago (seña) externo
          const señaAmount = parseFloat((total * randFloat(0.4, 0.6)).toFixed(2));
          const paidAt = atTime(addDays(orderDay, randInt(1, 4)), randInt(11, 17), randInt(0, 59));
          if (paidAt.getTime() <= NOW.getTime()) {
            const payId = uuid();
            supplierPaymentRows.push({
              id: payId, amount: señaAmount, currencyCode: sd.currency, source: 'EXTERNAL',
              purchaseOrderId: orderId, tenantId: tenant.id, tiendaId: null, cashMovementId: null,
              paidAt, paidById: U.OWNER.id, createdAt: paidAt,
            });
            ledgerRows.push({
              id: uuid(), tenantId: tenant.id, currencyCode: sd.currency, amount: -señaAmount, type: 'SUPPLIER_PAYMENT_EXTERNAL',
              supplierPaymentId: payId, description: `Pago a proveedor — orden #${orderId.slice(-6)}`,
              createdById: U.OWNER.id, createdAt: paidAt,
            });
          }
        }
      }
    });
    await tx.purchaseOrder.createMany({ data: poRows });
    await tx.purchaseOrderItem.createMany({ data: poItemRows });

    // ── Reparaciones (modelo pull + threads) ─────────────────────────
    const notifRows = [];
    const repairRows = [];
    const repairHistRows = [];
    const repairCommentRows = [];

    const mkRepair = ({ tiendaKey, status, dayOffset, assign, thread }) => {
      const tiendaId = T[tiendaKey].id;
      const seller = sellerOf[tiendaId];
      const createdAt = atTime(addDays(TODAY, dayOffset), randInt(10, 18), randInt(0, 59));
      const faultType = pick(Object.keys(FAULT_DESCRIPTIONS));
      const id = uuid();
      let readyAt = null, deliveredAt = null;
      if (['READY', 'DELIVERED'].includes(status)) readyAt = clampNow(addDays(createdAt, randInt(2, 5)));
      if (status === 'DELIVERED') deliveredAt = clampNow(addDays(readyAt ?? createdAt, randInt(0, 2)));

      repairRows.push({
        id, customerName: custName(), customerPhone: custPhone(),
        deviceModel: pick(REPAIR_DEVICE_POOL), deviceColor: pick(['Negro', 'Blanco', 'Azul', 'Medianoche', 'Rojo']),
        faultType, faultDescription: pick(FAULT_DESCRIPTIONS[faultType]), status,
        budget: assign ? Math.round(randFloat(18000, 160000) / 500) * 500 : null,
        readyAt, deliveredAt, technicianId: assign ? U.TECH.id : null, createdById: seller,
        tenantId: tenant.id, tiendaId, createdAt,
      });
      repairHistRows.push({ id: uuid(), status: 'RECEIVED', notes: 'Orden creada', repairId: id, changedById: seller, createdAt });
      if (assign) repairHistRows.push({ id: uuid(), status: 'RECEIVED', notes: 'Tomó la orden', repairId: id, changedById: U.TECH.id, createdAt: addHours(createdAt, 1) });
      if (status !== 'RECEIVED') {
        repairHistRows.push({
          id: uuid(), status, notes: status === 'READY' ? 'Reparación finalizada' : null, repairId: id,
          changedById: U.TECH.id, createdAt: status === 'DELIVERED' ? (deliveredAt ?? createdAt) : (readyAt ?? addHours(createdAt, 6)),
        });
      }

      // thread de comentarios
      if (thread && thread.length) {
        let t = addHours(createdAt, 2);
        thread.forEach((msg, mi) => {
          const fromTech = msg.by === 'tech';
          repairCommentRows.push({
            id: uuid(), body: msg.text, repairId: id, authorId: fromTech ? U.TECH.id : seller, fromTech, createdAt: t,
          });
          t = addHours(t, randInt(3, 20));
          if (t.getTime() > NOW.getTime()) t = addHours(NOW, -1);
        });
        // notificación al que le toca responder según el último comentario
        const last = thread[thread.length - 1];
        if (last.by === 'tech') {
          notifRows.push({
            id: uuid(), tenantId: tenant.id, userId: seller, read: false, type: 'INFO',
            message: `${U.TECH.name} comentó en la reparación de ${repairRows[repairRows.length - 1].customerName}.`,
            link: `/repairs/${id}`, createdAt: addHours(createdAt, 8),
          });
        } else {
          notifRows.push({
            id: uuid(), tenantId: tenant.id, userId: U.TECH.id, read: false, type: 'INFO',
            message: `Nuevo comentario en la reparación de ${repairRows[repairRows.length - 1].customerName}.`,
            link: `/repairs/${id}`, createdAt: addHours(createdAt, 8),
          });
        }
      }
      return id;
    };

    // Pool sin asignar (fresco, para tomar en vivo) — ambas sucursales
    mkRepair({ tiendaKey: 'CENTRO',  status: 'RECEIVED', dayOffset: -1, assign: false });
    mkRepair({ tiendaKey: 'CENTRO',  status: 'RECEIVED', dayOffset: 0,  assign: false });
    mkRepair({ tiendaKey: 'PALERMO', status: 'RECEIVED', dayOffset: -2, assign: false });
    mkRepair({ tiendaKey: 'PALERMO', status: 'RECEIVED', dayOffset: 0,  assign: false });

    // Tomadas + en proceso, con thread de ida y vuelta
    mkRepair({
      tiendaKey: 'CENTRO', status: 'IN_PROGRESS', dayOffset: -5, assign: true,
      thread: [
        { by: 'seller', text: 'El cliente dice que se moja y se apaga. Fijate si tiene humedad adentro.' },
        { by: 'tech',   text: 'Confirmado, oxidación en la placa. Hago limpieza ultrasónica y cambio el conector de batería. Te aviso.' },
        { by: 'seller', text: 'Dale. El cliente pregunta si llega para el sábado.' },
        { by: 'tech',   text: 'Sí, mañana a la tarde lo tengo listo.' },
      ],
    });
    mkRepair({
      tiendaKey: 'PALERMO', status: 'WAITING_PARTS', dayOffset: -4, assign: true,
      thread: [
        { by: 'tech',   text: 'Necesito pin de carga original, no tengo en stock. Lo pido y en 2 días lo tengo.' },
        { by: 'seller', text: 'Ok, le aviso al cliente. ¿Te confirmo el presupuesto de $45.000?' },
        { by: 'tech',   text: 'Sí, con el repuesto original queda en ese valor.' },
        { by: 'seller', text: 'Dale. ¿Ya llegó el repuesto? El cliente vuelve a preguntar.' },
      ],
    });
    mkRepair({
      tiendaKey: 'CENTRO', status: 'DIAGNOSING', dayOffset: -2, assign: true,
      thread: [
        { by: 'seller', text: 'Pantalla con líneas verticales tras una caída. ¿Es solo el módulo o también la placa?' },
        { by: 'tech',   text: 'Probando con una pantalla de prueba. En un rato te digo si es solo el display.' },
      ],
    });

    // Finalizadas / entregadas
    mkRepair({ tiendaKey: 'PALERMO', status: 'READY',     dayOffset: -6, assign: true });
    mkRepair({ tiendaKey: 'CENTRO',  status: 'DELIVERED', dayOffset: -9, assign: true });
    mkRepair({ tiendaKey: 'PALERMO', status: 'DELIVERED', dayOffset: -11, assign: true });
    mkRepair({ tiendaKey: 'CENTRO',  status: 'DELIVERED', dayOffset: -8, assign: true });

    await tx.repairOrder.createMany({ data: repairRows });
    await tx.repairStatusHistory.createMany({ data: repairHistRows });
    await tx.repairComment.createMany({ data: repairCommentRows });

    // ── Soporte ─────────────────────────────────────────────────────
    const ticket1Id = uuid();
    const t1Created = atTime(addDays(TODAY, -4), 12, 30);
    await tx.supportTicket.create({
      data: {
        id: ticket1Id, title: 'Consulta sobre remitos de transferencia', description: 'Cuando transfiero stock a Palermo, ¿se puede imprimir un remito con el detalle de los equipos?',
        category: 'CONSULTA_GENERAL', priority: 'MEDIA', status: 'EN_PROCESO',
        tenantId: tenant.id, userId: U.SELLER_CENTRO.id, createdAt: t1Created, updatedAt: t1Created,
      },
    });
    const t1ReplyAt = atTime(addDays(TODAY, -3), 10, 15);
    await tx.ticketReply.create({
      data: {
        id: uuid(), message: 'Hola Carla, gracias por escribir. Estamos evaluando sumar el remito imprimible en la próxima actualización. Te confirmamos novedades por acá.',
        isAdmin: true, ticketId: ticket1Id, userId: superadmin?.id ?? U.OWNER.id, createdAt: t1ReplyAt,
      },
    });
    notifRows.push({
      id: uuid(), tenantId: tenant.id, userId: U.SELLER_CENTRO.id, read: false, type: 'INFO',
      message: 'Respuesta en tu ticket de soporte: "Consulta sobre remitos de transferencia".',
      link: `/tickets/${ticket1Id}`, createdAt: t1ReplyAt,
    });

    const ticket2Id = uuid();
    const t2Created = atTime(addDays(TODAY, -2), 16, 5);
    await tx.supportTicket.create({
      data: {
        id: ticket2Id, title: 'Sugerencia: filtrar inventario por color', description: 'Estaría bueno poder filtrar el inventario por color además de modelo e IMEI.',
        category: 'SUGERENCIA', priority: 'BAJA', status: 'ABIERTO',
        tenantId: tenant.id, userId: U.SELLER_PALERMO.id, createdAt: t2Created, updatedAt: t2Created,
      },
    });

    // ── Notificaciones dirigidas extra ──────────────────────────────
    // Transferencia en camino a Centro -> SELLER de Centro
    notifRows.push({
      id: uuid(), tenantId: tenant.id, userId: U.SELLER_CENTRO.id, read: false, type: 'INFO',
      message: `Transferencia en camino a Centro desde Palermo: ${trItems.dispatched.length} equipos para recibir.`,
      link: `/transfers/${trDispId}`, createdAt: trDispDispatch,
    });
    // Alerta de stock bajo (tenant-wide)
    notifRows.push({
      id: uuid(), tenantId: tenant.id, userId: null, read: false, type: 'WARNING',
      message: 'Hay productos con stock por debajo del mínimo. Revisá el inventario.', link: '/inventory',
      createdAt: atTime(addDays(TODAY, -1), 9, 30),
    });

    await tx.notification.createMany({ data: notifRows });
    await tx.cashMovement.createMany({ data: cashMovementRows });
    await tx.supplierPayment.createMany({ data: supplierPaymentRows });
    await tx.ledgerEntry.createMany({ data: ledgerRows });
  }, { timeout: 300000, maxWait: 30000 });

  // ── Resumen ──────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  const tid = tenant.id;
  const [tiendas, users, products, inv, invAvail, invSold, invTransit, sales, cashSessions, cashOpen,
    cashMov, ledger, suppliers, pos, payments, repairs, repairsPool, repairComments, transfers, tickets, notifs] =
    await Promise.all([
      prisma.tienda.count({ where: { tenantId: tid } }),
      prisma.user.count({ where: { tenantId: tid } }),
      prisma.product.count({ where: { tenantId: tid } }),
      prisma.inventoryItem.count({ where: { tenantId: tid } }),
      prisma.inventoryItem.count({ where: { tenantId: tid, status: 'AVAILABLE' } }),
      prisma.inventoryItem.count({ where: { tenantId: tid, status: 'SOLD' } }),
      prisma.inventoryItem.count({ where: { tenantId: tid, status: 'IN_TRANSIT' } }),
      prisma.sale.count({ where: { tenantId: tid } }),
      prisma.cashSession.count({ where: { tenantId: tid } }),
      prisma.cashSession.count({ where: { tenantId: tid, closedAt: null } }),
      prisma.cashMovement.count({ where: { tenantId: tid } }),
      prisma.ledgerEntry.count({ where: { tenantId: tid } }),
      prisma.supplier.count({ where: { tenantId: tid } }),
      prisma.purchaseOrder.count({ where: { tenantId: tid } }),
      prisma.supplierPayment.count({ where: { tenantId: tid } }),
      prisma.repairOrder.count({ where: { tenantId: tid } }),
      prisma.repairOrder.count({ where: { tenantId: tid, technicianId: null } }),
      prisma.repairComment.count({ where: { repair: { tenantId: tid } } }),
      prisma.stockTransfer.count({ where: { tenantId: tid } }),
      prisma.supportTicket.count({ where: { tenantId: tid } }),
      prisma.notification.count({ where: { tenantId: tid, read: false } }),
    ]);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ${DEMO_NAME} — dataset de demo listo (tenant ${tid})`);
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Ventana:                  últimos 14 días (${ACTIVE_DAYS.length} días con actividad)`);
  console.log(`  Sucursales:               ${tiendas}  (Centro, Palermo)`);
  console.log(`  Usuarios:                 ${users}`);
  console.log(`  Productos:                ${products}`);
  console.log(`  Inventario:               ${inv}  (disp: ${invAvail}, vendidos: ${invSold}, en tránsito: ${invTransit})`);
  console.log(`  Ventas:                   ${sales}`);
  console.log(`  Cajas:                    ${cashSessions}  (abiertas ahora: ${cashOpen})`);
  console.log(`  Movimientos de caja:      ${cashMov}`);
  console.log(`  Asientos de ledger:       ${ledger}`);
  console.log(`  Proveedores / órdenes:    ${suppliers} / ${pos}  (pagos: ${payments})`);
  console.log(`  Reparaciones:             ${repairs}  (sin tomar: ${repairsPool}, comentarios: ${repairComments})`);
  console.log(`  Transferencias:           ${transfers}  (CLOSED / DISPATCHED / OPEN)`);
  console.log(`  Tickets de soporte:       ${tickets}`);
  console.log(`  Notificaciones sin leer:  ${notifs}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Login — password para todos: ${DEMO_PASSWORD}`);
  for (const u of USERS) {
    const suc = u.tienda ? TIENDAS.find((t) => t.key === u.tienda).name : '—';
    console.log(`    ${u.role.padEnd(7)} ${u.email.padEnd(30)} sucursal: ${suc}   (${u.name})`);
  }
  console.log('═══════════════════════════════════════════════════════\n');
}

// Ejecutado directo (node seed-loom.js / npm run seed:loom) → corre y desconecta.
// Importado como módulo → exporta run() sin auto-ejecutar ni desconectar el
// PrismaClient global (lo maneja el caller).
async function run() {
  await main();
}

if (require.main === module) {
  run()
    .catch((err) => { console.error('[seed-loom] ERROR:', err); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); });
}

module.exports = { run };
