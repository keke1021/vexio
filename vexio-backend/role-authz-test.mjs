/**
 * Verificación de autorización por ROL + SCOPE por SUCURSAL — Vexio
 *
 * Dos dimensiones independientes:
 *
 *   ROL — QUÉ puede hacer:
 *     OWNER / ADMIN / SELLER → acceso TOTAL a todos los módulos (lectura y escritura).
 *     TECH  → SOLO Reparaciones. 403 en todo lo demás (+ /notifications, /rates, /auth/password).
 *     SUPERADMIN → panel /admin.
 *
 *   SUCURSAL — DE QUÉ SUCURSAL ve/toca datos. La "sucursal activa" viaja en el JWT
 *   de la sesión (no es un tiendaId fijo del perfil). El backend valida SIEMPRE
 *   contra esa sucursal activa e ignora cualquier tiendaId que venga en query/body:
 *     OWNER / ADMIN → eligen sucursal al entrar (sin default silencioso si hay >1);
 *                     pueden cambiar entre todas las del tenant (POST /auth/select-tienda).
 *     SELLER        → fijo en su sucursal asignada, en TODOS los módulos, sin excepción.
 *     TECH          → EXCEPCIÓN EXPLÍCITA: ve Reparaciones de TODAS las sucursales
 *                     combinadas, sin elegir ninguna. Cada RepairOrder igual lleva su
 *                     tiendaId de origen, visible en lista y detalle.
 *     SUPERADMIN    → sin scope por sucursal.
 *
 * Levanta un tenant descartable (slug fijo `role-authz-test`), corre las
 * comprobaciones contra el backend local :3001 y borra todo al final (y si algo
 * explota en el medio).
 *
 * Uso (con el backend corriendo, desde vexio-backend/):  node role-authz-test.mjs
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3001/api';
const prisma = new PrismaClient();

const SLUG = 'role-authz-test';
const PASS = 'Test1234!';
const ALL_MODULES = ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties', 'whatsapp', 'reports', 'multibranch'];

// ─── setup / teardown ────────────────────────────────────────────────────────

async function wipe(tenantId) {
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { tenantId } });
    await tx.stockTransferItem.deleteMany({ where: { transfer: { tenantId } } });
    await tx.stockTransfer.deleteMany({ where: { tenantId } });
    await tx.delivery.deleteMany({ where: { tenantId } });
    await tx.supplierPayment.deleteMany({ where: { tenantId } });   // RESTRICT FK -> PurchaseOrder: borrar ANTES
    await tx.cashMovement.deleteMany({ where: { tenantId } });
    await tx.sale.deleteMany({ where: { tenantId } });
    await tx.cashSession.deleteMany({ where: { tenantId } });
    await tx.purchaseOrder.deleteMany({ where: { tenantId } });
    await tx.payment.deleteMany({ where: { tenantId } });
    await tx.repairOrder.deleteMany({ where: { tenantId } });
    await tx.customer.deleteMany({ where: { tenantId } });
    await tx.inventoryItem.deleteMany({ where: { tenantId } });
    await tx.product.deleteMany({ where: { tenantId } });
    await tx.supplier.deleteMany({ where: { tenantId } });
    await tx.notification.deleteMany({ where: { tenantId } });
    await tx.supportTicket.deleteMany({ where: { tenantId } });
    await tx.user.deleteMany({ where: { tenantId } });
    await tx.tienda.deleteMany({ where: { tenantId } });
    await tx.tenant.delete({ where: { id: tenantId } });
  }, { timeout: 60000 });
}

async function setup() {
  const existing = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (existing) await wipe(existing.id);

  const hashed = await bcrypt.hash(PASS, 12);
  const tenant = await prisma.tenant.create({
    data: { name: 'Role Authz Test', slug: SLUG, email: `${SLUG}@test.local`, status: 'ACTIVE', plan: 'FULL', activeModules: ALL_MODULES, maxUsers: 20 },
  });

  // 3 sucursales: A y B con usuarios, C sin usuarios (para lotes de transferencia
  // que no tocan ninguna sucursal "propia" de nadie).
  const tiendaA = await prisma.tienda.create({ data: { name: 'Sucursal A', tenantId: tenant.id } });
  const tiendaB = await prisma.tienda.create({ data: { name: 'Sucursal B', tenantId: tenant.id } });
  const tiendaC = await prisma.tienda.create({ data: { name: 'Sucursal C', tenantId: tenant.id } });

  const mkUser = (email, role, tiendaId) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], password: hashed, role, tenantId: tenant.id, tiendaId } });

  const owner   = await mkUser('owner@authztest.local',   'OWNER',  null);       // multi-sucursal
  const seller  = await mkUser('seller-a@authztest.local', 'SELLER', tiendaA.id); // fijo en A
  const sellerB = await mkUser('seller-b@authztest.local', 'SELLER', tiendaB.id); // fijo en B
  const tech    = await mkUser('tech@authztest.local',     'TECH',   tiendaA.id); // asignado a A, pero ve repairs de todas

  const product = await prisma.product.create({ data: { name: 'iPhone Authz', color: 'Negro', storage: '128GB', minStock: 0, tenantId: tenant.id } });
  let n = 0;
  const mkItem = (tiendaId) =>
    prisma.inventoryItem.create({
      data: { imei: `AUTHZ-${String(++n).padStart(3, '0')}`, condition: 'NEW', status: 'AVAILABLE',
              costPrice: 100, salePrice: 200, currencyCode: 'ARS', productId: product.id, tenantId: tenant.id, tiendaId },
    });
  const itemsA = []; for (let i = 0; i < 5; i++) itemsA.push(await mkItem(tiendaA.id));
  const itemsB = []; for (let i = 0; i < 3; i++) itemsB.push(await mkItem(tiendaB.id));

  const delivery = await prisma.delivery.create({ data: { name: 'Fletero Test', phone: '1122334455', tenantId: tenant.id } });

  // Caja abierta seed en B (para chequear que operar en A no la toca). A queda
  // sin caja abierta — la abre PARTE D y después PARTE C.
  await prisma.cashSession.create({ data: { tenantId: tenant.id, tiendaId: tiendaB.id, openedById: sellerB.id } });

  // Una venta por sucursal (mínima, sin items) — para el scope de GET /pos/sales.
  const saleA = await prisma.sale.create({
    data: { total: 111, paymentMethod: 'CASH', currencyCode: 'ARS', sellerId: owner.id, tenantId: tenant.id, tiendaId: tiendaA.id },
  });
  const saleB = await prisma.sale.create({
    data: { total: 222, paymentMethod: 'CASH', currencyCode: 'ARS', sellerId: owner.id, tenantId: tenant.id, tiendaId: tiendaB.id },
  });

  // Lote de transferencia C -> B: no toca la sucursal A. OWNER@A no debería verlo;
  // OWNER@B sí.
  const transferCB = await prisma.stockTransfer.create({
    data: { tenantId: tenant.id, fromTiendaId: tiendaC.id, toTiendaId: tiendaB.id, createdById: owner.id, status: 'OPEN' },
  });

  return { tenant, tiendaA, tiendaB, tiendaC, owner, seller, sellerB, tech, product, itemsA, itemsB, delivery, saleA, saleB, transferCB };
}

// ─── helpers HTTP ────────────────────────────────────────────────────────────

async function loginFull(email) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(d)}`);
  return d; // { accessToken, refreshToken, user, tenant, activeTienda?, availableTiendas? }
}

// Token "plano" para roles que ya quedan scopeados solos (SELLER/TECH: una sola
// sucursal posible) o para el baseline (cuando select-tienda todavía no existe).
async function login(email) {
  return (await loginFull(email)).accessToken;
}

async function selectTienda(refreshToken, tiendaId) {
  const r = await fetch(`${BASE}/auth/select-tienda`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, tiendaId }),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

// Token de `email` scopeado a `tiendaId`. Si el login ya trae esa sucursal
// activa, se usa directo. Si no, se pide vía select-tienda. Baseline (sin
// endpoint): cae al token plano — sin scoping server-side, alcanza igual.
async function tokenForBranch(email, tiendaId) {
  const d = await loginFull(email);
  if (d.activeTienda?.id === tiendaId) return d.accessToken;
  const sel = await selectTienda(d.refreshToken, tiendaId);
  if (sel.status === 200 && sel.data?.accessToken) return sel.data.accessToken;
  return d.accessToken;
}

async function req(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

let failures = 0;
const check = (label, actual, want) => {
  const ok = Array.isArray(want) ? want.includes(actual) : actual === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} -> ${actual} (esperado ${Array.isArray(want) ? want.join('/') : want})`);
};
const checkTrue = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

let T; // tokens

// SELLER debe comportarse EXACTAMENTE como OWNER: mismo status y ambos 2xx.
const sameAsOwner = async (label, method, path, body) => {
  const [o, s] = await Promise.all([
    req(method, path, T.OWNER, body),
    req(method, path, T.SELLER, body),
  ]);
  const ok = o.status === s.status && s.status >= 200 && s.status < 300;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  SELLER==OWNER  ${label}  (owner ${o.status} / seller ${s.status})`);
};

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[setup] creando tenant descartable (3 sucursales A/B/C, OWNER/SELLER_A/SELLER_B/TECH)...');
  const s = await setup();
  const A = s.tiendaA.id, B = s.tiendaB.id;

  // OWNER es multi-sucursal: para PARTE A/B/C lo dejamos scopeado a A. Baseline
  // (sin select-tienda): tokenForBranch devuelve el token plano.
  T = {
    OWNER:    await tokenForBranch(s.owner.email, A),
    SELLER:   await login(s.seller.email),
    SELLER_B: await login(s.sellerB.email),
    TECH:     await login(s.tech.email),
  };

  // ═══ PARTE A — TECH: SOLO Reparaciones ════════════════════════════════════
  console.log('\n=== PARTE A: TECH solo tiene Reparaciones ===');

  check('TECH GET  /repairs',              (await req('GET','/repairs', T.TECH)).status, 200);
  check('TECH GET  /repairs/stats',        (await req('GET','/repairs/stats', T.TECH)).status, 200);
  check('TECH GET  /repairs/technicians',  (await req('GET','/repairs/technicians', T.TECH)).status, 200);
  const techRepair = await req('POST','/repairs', T.TECH, {
    customerName: 'Cliente TECH', customerPhone: '111', deviceModel: 'iPhone 12',
    faultType: 'SCREEN', faultDescription: 'rota', tiendaId: A,
  });
  check('TECH POST /repairs',              techRepair.status, 201);
  const techRepairId = techRepair.data?.id;
  check('TECH GET  /repairs/:id (propia)', (await req('GET',`/repairs/${techRepairId}`, T.TECH)).status, 200);
  check('TECH PUT  /repairs/:id (propia)', (await req('PUT',`/repairs/${techRepairId}`, T.TECH, { internalNotes: 'diag' })).status, 200);
  check('TECH DELETE /repairs/:id (reservado a OWNER/ADMIN/SELLER)', (await req('DELETE',`/repairs/${techRepairId}`, T.TECH)).status, 403);

  const techForbidden = [
    ['GET',  `/cash/current?tiendaId=${A}`],
    ['GET',  `/cash/summary?tiendaId=${A}`],
    ['GET',  `/cash/sessions?tiendaId=${A}`],
    ['POST', '/cash/open', { tiendaId: A }],
    ['POST', '/cash/movements', { tiendaId: A, type: 'INCOME', amount: 1, description: 'x', paymentMethod: 'CASH', currencyCode: 'ARS' }],
    ['GET',  '/pos/sales'],
    ['GET',  '/pos/search-item?q=x'],
    ['POST', '/pos/sales', {}],
    ['GET',  '/inventory'],
    ['GET',  '/inventory/alerts'],
    ['GET',  '/products'],
    ['POST', '/inventory', { tiendaId: A }],
    ['GET',  '/suppliers'],
    ['GET',  '/suppliers/whatever'],
    ['GET',  '/suppliers/whatever/orders'],
    ['POST', '/suppliers', { name: 'x' }],
    ['GET',  '/reports/sales?from=2020-01-01&to=2030-01-01'],
    ['GET',  '/reports/cash?from=2020-01-01&to=2030-01-01'],
    ['GET',  '/reports/inventory'],
    ['GET',  '/reports/products?from=2020-01-01&to=2030-01-01'],
    ['GET',  '/reports/repairs?from=2020-01-01&to=2030-01-01'],
    ['GET',  '/stock-transfers'],
    ['GET',  `/stock-transfers?tiendaId=${A}`],
    ['GET',  '/stock-transfers/deliveries'],
    ['POST', '/stock-transfers/items', { inventoryItemId: s.itemsA[0].id, toTiendaId: B }],
    ['GET',  '/tickets'],
    ['POST', '/tickets', { title: 't', description: 'd', category: 'CONSULTA_GENERAL' }],
  ];
  for (const [m, p, b] of techForbidden) {
    check(`TECH ${m.padEnd(4)} ${p.split('?')[0]}`, (await req(m, p, T.TECH, b)).status, 403);
  }

  check('TECH GET /notifications (bell del Layout — se deja)', (await req('GET','/notifications', T.TECH)).status, 200);
  check('TECH GET /rates (se deja)',                           (await req('GET','/rates', T.TECH)).status, 200);
  // /tiendas: lista de sucursales (no sensible) — abierta a cualquier
  // autenticado; el TECH la precisa para elegir la sucursal de origen del
  // equipo al cargar una reparación.
  check('TECH GET /tiendas (lookup, se deja)',                 (await req('GET','/tiendas', T.TECH)).status, 200);

  // ═══ PARTE B — SELLER == OWNER en lecturas (misma sucursal activa: A) ══════
  console.log('\n=== PARTE B: SELLER == OWNER (lecturas, sucursal activa A) ===');

  await sameAsOwner('GET /cash/current',      'GET', `/cash/current?tiendaId=${A}`);
  await sameAsOwner('GET /cash/summary',      'GET', `/cash/summary?tiendaId=${A}`);
  await sameAsOwner('GET /cash/sessions',     'GET', `/cash/sessions?tiendaId=${A}`);
  await sameAsOwner('GET /pos/sales',         'GET', '/pos/sales');
  await sameAsOwner('GET /pos/search-item',   'GET', '/pos/search-item?q=iphone');
  await sameAsOwner('GET /inventory',         'GET', '/inventory');
  await sameAsOwner('GET /inventory/alerts',  'GET', '/inventory/alerts');
  await sameAsOwner('GET /products',          'GET', '/products');
  await sameAsOwner('GET /tiendas',           'GET', '/tiendas');
  await sameAsOwner('GET /suppliers',         'GET', '/suppliers');
  await sameAsOwner('GET /reports/sales',     'GET', '/reports/sales?from=2020-01-01&to=2030-01-01');
  await sameAsOwner('GET /reports/products',  'GET', '/reports/products?from=2020-01-01&to=2030-01-01');
  await sameAsOwner('GET /reports/inventory', 'GET', '/reports/inventory');
  await sameAsOwner('GET /reports/repairs',   'GET', '/reports/repairs?from=2020-01-01&to=2030-01-01');
  await sameAsOwner('GET /reports/cash',      'GET', '/reports/cash?from=2020-01-01&to=2030-01-01');
  await sameAsOwner('GET /stock-transfers (scopeado a la sucursal activa)', 'GET', '/stock-transfers');
  await sameAsOwner('GET /stock-transfers?tiendaId=B (param ignorado, usa la activa)', 'GET', `/stock-transfers?tiendaId=${B}`);
  await sameAsOwner('GET /stock-transfers/deliveries', 'GET', '/stock-transfers/deliveries');
  await sameAsOwner('GET /repairs',           'GET', '/repairs');
  await sameAsOwner('GET /repairs/technicians','GET', '/repairs/technicians');
  await sameAsOwner('GET /tickets',           'GET', '/tickets');
  await sameAsOwner('GET /notifications',     'GET', '/notifications');

  // ═══ PARTE D — SCOPE POR SUCURSAL ════════════════════════════════════════
  console.log('\n=== PARTE D: scope por sucursal (sucursal activa en el JWT) ===');

  // ── D1: el login expone la sucursal activa / las disponibles ──────────────
  const ownerLogin  = await loginFull(s.owner.email);
  const sellerLogin  = await loginFull(s.seller.email);
  const techLogin    = await loginFull(s.tech.email);

  check('D1 OWNER login: activeTienda null (multi-sucursal, sin default silencioso)', ownerLogin.activeTienda ?? null, null);
  checkTrue('D1 OWNER login: availableTiendas trae las 3 sucursales', (ownerLogin.availableTiendas?.length ?? 0) === 3);
  check('D1 SELLER_A login: activeTienda = A (auto, única posible)', sellerLogin.activeTienda?.id, A);
  check('D1 TECH login: activeTienda = A (auto, única posible)',     techLogin.activeTienda?.id, A);

  // ── D2: POST /auth/select-tienda (selección inicial + cambio de sucursal) ─
  check('D2 OWNER select-tienda A -> 200',                (await selectTienda(ownerLogin.refreshToken, A)).status, 200);
  check('D2 OWNER select-tienda B -> 200',                (await selectTienda(ownerLogin.refreshToken, B)).status, 200);
  check('D2 OWNER select-tienda id inexistente -> 400/403', (await selectTienda(ownerLogin.refreshToken, 'no-existe-xyz')).status, [400, 403]);
  check('D2 SELLER_A select-tienda B (sucursal ajena) -> 403', (await selectTienda(sellerLogin.refreshToken, B)).status, 403);
  check('D2 SELLER_A select-tienda A (su sucursal) -> 200',    (await selectTienda(sellerLogin.refreshToken, A)).status, 200);

  // JWT firmado a mano con tiendaId ajeno (firma inválida respecto del secret
  // real solo si el atacante no lo tiene; acá lo tenemos, así que probamos el
  // caso "firma rota" — editar el claim client-side sin re-firmar).
  const forged = jwt.sign({ userId: s.seller.id, tenantId: s.tenant.id, role: 'SELLER', tiendaId: B }, 'secret-equivocado');
  check('D2 token con firma inválida -> 401', (await req('GET', '/inventory', forged)).status, 401);

  // ── tokens scopeados por sucursal ────────────────────────────────────────
  const ownerA = await tokenForBranch(s.owner.email, A);
  const ownerB = await tokenForBranch(s.owner.email, B);
  const sellerAtok = await tokenForBranch(s.seller.email, A);

  // ── D3: lecturas scopeadas a la sucursal activa ─────────────────────────
  const aMarker = s.itemsA[4].id;  // items 0/1/2 los consume PARTE D/C; 3/4 quedan intactos
  const bMarker = s.itemsB[2].id;

  const invA = await req('GET', '/inventory?pageSize=100', ownerA);
  checkTrue('D3 OWNER@A GET /inventory: incluye un item de A',      (invA.data?.items ?? []).some((i) => i.id === aMarker));
  checkTrue('D3 OWNER@A GET /inventory: NO incluye ningún item de B', !(invA.data?.items ?? []).some((i) => i.id === bMarker));
  checkTrue('D3 OWNER@A GET /inventory: todo pertenece a A',         (invA.data?.items ?? []).length > 0 && (invA.data.items).every((i) => (i.tienda?.id ?? i.tiendaId) === A));

  const invB = await req('GET', '/inventory?pageSize=100', ownerB);
  checkTrue('D3 OWNER@B GET /inventory: incluye un item de B',       (invB.data?.items ?? []).some((i) => i.id === bMarker));
  checkTrue('D3 OWNER@B GET /inventory: NO incluye ningún item de A', !(invB.data?.items ?? []).some((i) => i.id === aMarker));

  const sumA = await req('GET', '/cash/summary', ownerA); // sin ?tiendaId — sale de la sucursal activa
  check('D3 OWNER@A GET /cash/summary sin ?tiendaId -> 200', sumA.status, 200);
  const curB = await req('GET', '/cash/current', ownerB);
  check('D3 OWNER@B GET /cash/current: la sesión abierta es de B', curB.data?.session?.tiendaId ?? curB.data?.session?.tienda?.id, B);

  const salesA = await req('GET', '/pos/sales', ownerA);
  checkTrue('D3 OWNER@A GET /pos/sales: incluye la venta de A',       (salesA.data?.sales ?? []).some((x) => x.id === s.saleA.id));
  checkTrue('D3 OWNER@A GET /pos/sales: NO incluye la venta de B',   !(salesA.data?.sales ?? []).some((x) => x.id === s.saleB.id));

  const repInvA = await req('GET', '/reports/inventory', ownerA);
  const repInvB = await req('GET', '/reports/inventory', ownerB);
  checkTrue('D3 reports/inventory: A y B reportan totales independientes (no el total del tenant)',
    (repInvA.data?.totalItems ?? 0) > 0 && (repInvB.data?.totalItems ?? 0) > 0 &&
    (repInvA.data.totalItems + repInvB.data.totalItems) <= 8 &&
    repInvA.data.totalItems !== (repInvA.data.totalItems + repInvB.data.totalItems));

  const trA = await req('GET', '/stock-transfers?pageSize=100', ownerA);
  checkTrue('D3 OWNER@A GET /stock-transfers: NO incluye el lote C->B', !(trA.data?.transfers ?? []).some((t) => t.id === s.transferCB.id));
  const trB = await req('GET', '/stock-transfers?pageSize=100', ownerB);
  checkTrue('D3 OWNER@B GET /stock-transfers: SÍ incluye el lote C->B',  (trB.data?.transfers ?? []).some((t) => t.id === s.transferCB.id));
  check('D3 OWNER@A GET /stock-transfers/:id de un lote que no toca A -> 403/404',
    (await req('GET', `/stock-transfers/${s.transferCB.id}`, ownerA)).status, [403, 404]);

  // ── D4: escrituras usan la sucursal activa del JWT, ignoran el body ──────
  const openA = await req('POST', '/cash/open', ownerA, { tiendaId: B }); // pide B, pero la sesión activa es A
  check('D4 OWNER@A POST /cash/open {tiendaId:B}: abre en A ignorando el body -> 201', openA.status, 201);
  const curAfterOpen = await req('GET', '/cash/current', ownerA);
  check('D4 la sesión recién abierta es de A, no de B', curAfterOpen.data?.session?.tiendaId ?? curAfterOpen.data?.session?.tienda?.id, A);
  const curBUnaffected = await req('GET', '/cash/current', ownerB);
  check('D4 la caja de B sigue siendo su sesión seed (no se abrió una nueva)', curBUnaffected.data?.session?.tiendaId ?? curBUnaffected.data?.session?.tienda?.id, B);
  await req('POST', '/cash/close', ownerA, {}); // limpiar: cerrar A para PARTE C

  // ── D5: Reparaciones — RepairOrder lleva tiendaId; SELLER scopeado, TECH ve todo ─
  const repA = await req('POST', '/repairs', sellerAtok, {
    customerName: 'Cliente A', customerPhone: '1', deviceModel: 'iPhone 11', faultType: 'SCREEN', faultDescription: 'x', tiendaId: A,
  });
  check('D5 SELLER_A POST /repairs -> 201', repA.status, 201);
  check('D5 la reparación queda en la sucursal activa del SELLER (A)', repA.data?.tiendaId ?? repA.data?.tienda?.id, A);

  const repB = await req('POST', '/repairs', await tokenForBranch(s.sellerB.email, B), {
    customerName: 'Cliente B', customerPhone: '2', deviceModel: 'iPhone 12', faultType: 'BATTERY', faultDescription: 'y', tiendaId: B,
  });
  check('D5 SELLER_B POST /repairs -> 201', repB.status, 201);
  check('D5 la reparación de SELLER_B queda en B', repB.data?.tiendaId ?? repB.data?.tienda?.id, B);

  const sellerARepairs = await req('GET', '/repairs', sellerAtok);
  checkTrue('D5 SELLER_A GET /repairs: solo reparaciones de A',
    (sellerARepairs.data?.repairs ?? []).length > 0 &&
    (sellerARepairs.data.repairs).every((r) => (r.tiendaId ?? r.tienda?.id) === A));
  checkTrue('D5 SELLER_A GET /repairs: NO ve la reparación de B',
    !(sellerARepairs.data?.repairs ?? []).some((r) => r.id === repB.data?.id));

  // TECH ve reparaciones de TODAS las sucursales (excepción explícita), con la
  // sucursal de origen visible. Asignamos ambas al TECH (el scope por técnico
  // del modelo de rol se mantiene intacto). OJO: cada PUT tiene que hacerse con
  // un token scopeado a la sucursal de la orden (una orden de B no se puede
  // tocar desde una sesión parada en A).
  check('D5 asignar técnico a repair A', (await req('PUT', `/repairs/${repA.data.id}`, sellerAtok, { technicianId: s.tech.id })).status, 200);
  check('D5 asignar técnico a repair B', (await req('PUT', `/repairs/${repB.data.id}`, await tokenForBranch(s.sellerB.email, B), { technicianId: s.tech.id })).status, 200);
  const techRepairs = await req('GET', '/repairs', T.TECH);
  const techIds = (techRepairs.data?.repairs ?? []).map((r) => r.id);
  checkTrue('D5 TECH ve la reparación de A', techIds.includes(repA.data.id));
  checkTrue('D5 TECH ve la reparación de B SIN elegir sucursal', techIds.includes(repB.data.id));
  checkTrue('D5 cada reparación expone su sucursal de origen (lista)',
    (techRepairs.data?.repairs ?? []).every((r) => r.tienda?.name || r.tiendaId));
  const techRepBDetail = await req('GET', `/repairs/${repB.data.id}`, T.TECH);
  checkTrue('D5 el detalle de una reparación expone su sucursal de origen',
    !!(techRepBDetail.data?.tienda?.name || techRepBDetail.data?.tiendaId));

  // TECH puede cargar una reparación eligiendo CUALQUIER sucursal de origen
  // (el equipo puede venir de cualquiera), no solo su sucursal asignada (A).
  const techRepB = await req('POST', '/repairs', T.TECH, {
    customerName: 'Cliente equipo de B', customerPhone: '9', deviceModel: 'iPhone 14',
    faultType: 'SCREEN', faultDescription: 'z', tiendaId: B,
  });
  check('D5 TECH POST /repairs con tiendaId=B (sucursal ajena) -> 201', techRepB.status, 201);
  check('D5 la reparación cargada por el TECH queda en la sucursal elegida (B)', techRepB.data?.tiendaId ?? techRepB.data?.tienda?.id, B);

  // ── D6: Transferencias — SELLER opera SOLO su sucursal ───────────────────
  const d6 = await req('POST', '/stock-transfers/items', sellerAtok, { inventoryItemId: s.itemsA[2].id, toTiendaId: B });
  check('D6 SELLER_A add item (origen A propio) -> 201', d6.status, 201);
  await req('POST', `/stock-transfers/${d6.data.id}/dispatch`, sellerAtok, { deliveryId: s.delivery.id });
  check('D6 SELLER_A receive-all sobre destino ajeno (B) -> 403',
    (await req('POST', `/stock-transfers/${d6.data.id}/receive-all`, sellerAtok)).status, 403);
  check('D6 SELLER_B receive-all sobre destino propio (B) -> 200',
    (await req('POST', `/stock-transfers/${d6.data.id}/receive-all`, await tokenForBranch(s.sellerB.email, B))).status, 200);

  // ── D7: Proveedores — catálogo compartido, órdenes scopeadas a la sucursal activa ─
  const supD = await req('POST', '/suppliers', ownerA, { name: 'Prov Scope', city: 'CABA', paymentDays: 30 });
  const supDId = supD.data?.id;
  checkTrue('D7 SELLER_B ve el proveedor creado desde A (catálogo compartido)',
    ((await req('GET', '/suppliers', await tokenForBranch(s.sellerB.email, B))).data?.suppliers ?? []).some((x) => x.id === supDId));
  const ordA = await req('POST', `/suppliers/${supDId}/orders`, ownerA, { currency: 'ARS', items: [{ description: 'lote A', quantity: 1, unitPrice: 1000 }] });
  check('D7 OWNER@A crea orden de compra -> 201', ordA.status, 201);
  check('D7 la orden queda estampada con la sucursal activa (A)', ordA.data?.tiendaId, A);
  const ordersFromB = await req('GET', `/suppliers/${supDId}/orders`, ownerB);
  checkTrue('D7 OWNER@B NO ve la orden creada en A', !((ordersFromB.data?.orders ?? []).some((o) => o.id === ordA.data?.id)));

  // ═══ PARTE C — SELLER puede ESCRIBIR en todos los módulos (sucursal A) ════
  console.log('\n=== PARTE C: SELLER escribe en todos los módulos (2xx, sucursal A) ===');

  check('SELLER_A POST /cash/open (A)',      (await req('POST','/cash/open', T.SELLER, { tiendaId: A })).status, 201);
  check('SELLER_A POST /cash/movements (A)', (await req('POST','/cash/movements', T.SELLER, {
    tiendaId: A, type: 'INCOME', amount: 1500, description: 'ajuste', paymentMethod: 'CASH', currencyCode: 'ARS',
  })).status, 201);
  check('SELLER_A POST /cash/close (A)',     (await req('POST','/cash/close', T.SELLER, { tiendaId: A })).status, 200);

  const invNew = await req('POST','/inventory', T.SELLER, {
    tiendaId: A, productName: 'iPhone Authz', color: 'Negro', storage: '128GB',
    imei: 'AUTHZ-NEW-1', condition: 'NEW', costPrice: 100, salePrice: 300, currencyCode: 'ARS',
  });
  check('SELLER_A POST /inventory', invNew.status, 201);
  const invId = invNew.data?.id;
  check('SELLER_A PUT  /inventory/:id',    (await req('PUT',`/inventory/${invId}`, T.SELLER, { salePrice: 350 })).status, 200);
  check('SELLER_A DELETE /inventory/:id',  (await req('DELETE',`/inventory/${invId}`, T.SELLER)).status, 200);

  const sup = await req('POST','/suppliers', T.SELLER, { name: 'Prov SELLER', city: 'CABA', paymentDays: 30 });
  check('SELLER_A POST /suppliers', sup.status, 201);
  const supId = sup.data?.id;
  check('SELLER_A PUT  /suppliers/:id', (await req('PUT',`/suppliers/${supId}`, T.SELLER, { notes: 'x' })).status, 200);
  const ord = await req('POST',`/suppliers/${supId}/orders`, T.SELLER, { currency: 'ARS', items: [{ description: 'lote', quantity: 2, unitPrice: 10000 }] });
  check('SELLER_A POST /suppliers/:id/orders', ord.status, 201);
  check('SELLER_A POST /suppliers/orders/:id/payments', (await req('POST',`/suppliers/orders/${ord.data?.id}/payments`, T.SELLER, { amount: 5000, currency: 'ARS', source: 'EXTERNAL' })).status, 201);
  const supBare = await req('POST','/suppliers', T.SELLER, { name: 'Prov a borrar', city: 'CABA', paymentDays: 30 });
  check('SELLER_A DELETE /suppliers/:id (baja)', (await req('DELETE',`/suppliers/${supBare.data?.id}`, T.SELLER)).status, 200);

  // Transferencias: SELLER_A opera su sucursal (origen A). Recibir en B lo hace SELLER_B.
  const tr = await req('POST','/stock-transfers/items', T.SELLER, { inventoryItemId: s.itemsA[0].id, toTiendaId: B });
  check('SELLER_A POST /stock-transfers/items (A->B)', tr.status, 201);
  const trId = tr.data?.id;
  check('SELLER_A POST /stock-transfers/:id/dispatch',    (await req('POST',`/stock-transfers/${trId}/dispatch`, T.SELLER, { deliveryId: s.delivery.id })).status, 200);
  check('SELLER_B POST /stock-transfers/:id/receive-all', (await req('POST',`/stock-transfers/${trId}/receive-all`, T.SELLER_B)).status, 200);
  const del = await req('POST','/stock-transfers/deliveries', T.SELLER, { name: 'Fletero SELLER', phone: '555' });
  check('SELLER_A POST /stock-transfers/deliveries',  del.status, 201);
  check('SELLER_A PATCH /stock-transfers/deliveries/:id', (await req('PATCH',`/stock-transfers/deliveries/${del.data?.id}`, T.SELLER, { phone: '556' })).status, 200);
  const tr2 = await req('POST','/stock-transfers/items', T.SELLER, { inventoryItemId: s.itemsA[1].id, toTiendaId: B });
  const tr2ItemId = tr2.data?.transferItems?.[0]?.id;
  check('SELLER_A POST /stock-transfers/:id/items/:itemId/cancel', (await req('POST',`/stock-transfers/${tr2.data?.id}/items/${tr2ItemId}/cancel`, T.SELLER, { reason: 'test' })).status, 200);

  const rep = await req('POST','/repairs', T.SELLER, { customerName: 'C', customerPhone: '1', deviceModel: 'iPhone 13', faultType: 'BATTERY', faultDescription: 'no carga', tiendaId: A });
  check('SELLER_A POST /repairs', rep.status, 201);
  check('SELLER_A PUT  /repairs/:id',    (await req('PUT',`/repairs/${rep.data?.id}`, T.SELLER, { budget: 20000 })).status, 200);
  check('SELLER_A DELETE /repairs/:id',  (await req('DELETE',`/repairs/${rep.data?.id}`, T.SELLER)).status, 200);

  check('SELLER_A POST /tickets', (await req('POST','/tickets', T.SELLER, { title: 't', description: 'd', category: 'CONSULTA_GENERAL' })).status, 201);

  const posSale = await req('POST','/pos/sales', T.SELLER, {});
  checkTrue(`SELLER_A POST /pos/sales pasa authz (status ${posSale.status}, no 401/403)`, posSale.status !== 401 && posSale.status !== 403);

  console.log('\n[teardown] borrando tenant descartable...');
  await wipe(s.tenant.id);

  console.log(`\n${failures === 0 ? 'TODO OK' : failures + ' FALLARON'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try {
    const t = await prisma.tenant.findUnique({ where: { slug: SLUG } });
    if (t) { await wipe(t.id); console.error('[cleanup] tenant descartable borrado tras el error'); }
  } catch {}
  process.exit(1);
});
