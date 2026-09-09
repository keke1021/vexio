/**
 * Verificación de autorización por rol — Vexio
 *
 * Regla vigente:
 *   OWNER / ADMIN / SELLER  → acceso TOTAL a todo el sistema (mismos módulos,
 *     misma lectura y escritura, sin excepciones).
 *   TECH  → SOLO el módulo de Reparaciones. 403 en todo lo demás. Se le dejan
 *     abiertos /notifications y /rates (chrome compartido) y /auth/password.
 *
 * Levanta un tenant descartable (slug fijo `role-authz-test`), corre las
 * comprobaciones contra el backend local :3001 y borra todo al final (y si
 * algo explota en el medio).
 *
 * Uso (con el backend corriendo, desde vexio-backend/):  node role-authz-test.mjs
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
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
  const tiendaA = await prisma.tienda.create({ data: { name: 'Sucursal A', tenantId: tenant.id } });
  const tiendaB = await prisma.tienda.create({ data: { name: 'Sucursal B', tenantId: tenant.id } });

  const mkUser = (email, role, tiendaId) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], password: hashed, role, tenantId: tenant.id, tiendaId } });

  const owner  = await mkUser('owner@authztest.local',  'OWNER',  null);
  const seller = await mkUser('seller@authztest.local', 'SELLER', tiendaA.id);
  const tech   = await mkUser('tech@authztest.local',   'TECH',   tiendaA.id);

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

  return { tenant, tiendaA, tiendaB, owner, seller, tech, product, itemsA, itemsB, delivery };
}

// ─── helpers HTTP ────────────────────────────────────────────────────────────

async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(d)}`);
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
  console.log('[setup] creando tenant descartable (2 sucursales, OWNER/SELLER/TECH)...');
  const s = await setup();
  T = {
    OWNER:  await login(s.owner.email),
    SELLER: await login(s.seller.email),
    TECH:   await login(s.tech.email),
  };
  const A = s.tiendaA.id, B = s.tiendaB.id;

  // ═══ PARTE A — TECH: SOLO Reparaciones ════════════════════════════════════
  console.log('\n=== PARTE A: TECH solo tiene Reparaciones ===');

  // Reparaciones: acceso completo (salvo DELETE)
  check('TECH GET  /repairs',              (await req('GET','/repairs', T.TECH)).status, 200);
  check('TECH GET  /repairs/stats',        (await req('GET','/repairs/stats', T.TECH)).status, 200);
  check('TECH GET  /repairs/technicians',  (await req('GET','/repairs/technicians', T.TECH)).status, 200);
  const techRepair = await req('POST','/repairs', T.TECH, {
    customerName: 'Cliente TECH', customerPhone: '111', deviceModel: 'iPhone 12',
    faultType: 'SCREEN', faultDescription: 'rota',
  });
  check('TECH POST /repairs',              techRepair.status, 201);
  const techRepairId = techRepair.data?.id;
  check('TECH GET  /repairs/:id (propia)', (await req('GET',`/repairs/${techRepairId}`, T.TECH)).status, 200);
  check('TECH PUT  /repairs/:id (propia)', (await req('PUT',`/repairs/${techRepairId}`, T.TECH, { internalNotes: 'diag' })).status, 200);
  check('TECH DELETE /repairs/:id (reservado a OWNER/ADMIN/SELLER)', (await req('DELETE',`/repairs/${techRepairId}`, T.TECH)).status, 403);

  // Todo lo demás: 403
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
    ['GET',  '/tiendas'],
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

  // Mínimo dejado a TECH para que la app no rompa (chrome compartido / cuenta)
  check('TECH GET /notifications (bell del Layout — se deja)', (await req('GET','/notifications', T.TECH)).status, 200);
  check('TECH GET /rates (se deja)',                           (await req('GET','/rates', T.TECH)).status, 200);

  // ═══ PARTE B — SELLER == OWNER en lecturas ════════════════════════════════
  console.log('\n=== PARTE B: SELLER == OWNER (lecturas) ===');

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
  await sameAsOwner('GET /stock-transfers (listado completo, sin tiendaId)', 'GET', '/stock-transfers');
  await sameAsOwner('GET /stock-transfers?tiendaId=B (cualquier sucursal)',  'GET', `/stock-transfers?tiendaId=${B}`);
  await sameAsOwner('GET /stock-transfers/deliveries', 'GET', '/stock-transfers/deliveries');
  await sameAsOwner('GET /repairs',           'GET', '/repairs');
  await sameAsOwner('GET /repairs/technicians','GET', '/repairs/technicians');
  await sameAsOwner('GET /tickets',           'GET', '/tickets');
  await sameAsOwner('GET /notifications',     'GET', '/notifications');

  // ═══ PARTE C — SELLER puede ESCRIBIR en todos los módulos ═════════════════
  console.log('\n=== PARTE C: SELLER escribe en todos los módulos (2xx) ===');

  // Caja: flujo completo en la sucursal B
  check('SELLER POST /cash/open (B)',      (await req('POST','/cash/open', T.SELLER, { tiendaId: B })).status, 201);
  check('SELLER POST /cash/movements (B)', (await req('POST','/cash/movements', T.SELLER, {
    tiendaId: B, type: 'INCOME', amount: 1500, description: 'ajuste', paymentMethod: 'CASH', currencyCode: 'ARS',
  })).status, 201);
  check('SELLER POST /cash/close (B)',     (await req('POST','/cash/close', T.SELLER, { tiendaId: B })).status, 200);

  // Inventario
  const invNew = await req('POST','/inventory', T.SELLER, {
    tiendaId: A, productName: 'iPhone Authz', color: 'Negro', storage: '128GB',
    imei: 'AUTHZ-NEW-1', condition: 'NEW', costPrice: 100, salePrice: 300, currencyCode: 'ARS',
  });
  check('SELLER POST /inventory', invNew.status, 201);
  const invId = invNew.data?.id;
  check('SELLER PUT  /inventory/:id',    (await req('PUT',`/inventory/${invId}`, T.SELLER, { salePrice: 350 })).status, 200);
  check('SELLER DELETE /inventory/:id',  (await req('DELETE',`/inventory/${invId}`, T.SELLER)).status, 200);

  // Proveedores
  const sup = await req('POST','/suppliers', T.SELLER, { name: 'Prov SELLER', city: 'CABA', paymentDays: 30 });
  check('SELLER POST /suppliers', sup.status, 201);
  const supId = sup.data?.id;
  check('SELLER PUT  /suppliers/:id', (await req('PUT',`/suppliers/${supId}`, T.SELLER, { notes: 'x' })).status, 200);
  const ord = await req('POST',`/suppliers/${supId}/orders`, T.SELLER, { currency: 'ARS', items: [{ description: 'lote', quantity: 2, unitPrice: 10000 }] });
  check('SELLER POST /suppliers/:id/orders', ord.status, 201);
  check('SELLER POST /suppliers/orders/:id/payments', (await req('POST',`/suppliers/orders/${ord.data?.id}/payments`, T.SELLER, { amount: 5000, currency: 'ARS', source: 'EXTERNAL' })).status, 201);
  const supBare = await req('POST','/suppliers', T.SELLER, { name: 'Prov a borrar', city: 'CABA', paymentDays: 30 });
  check('SELLER DELETE /suppliers/:id (baja)', (await req('DELETE',`/suppliers/${supBare.data?.id}`, T.SELLER)).status, 200);

  // Transferencias: SELLER sin restricción de sucursal (== OWNER)
  const tr = await req('POST','/stock-transfers/items', T.SELLER, { inventoryItemId: s.itemsA[0].id, toTiendaId: B });
  check('SELLER POST /stock-transfers/items (A->B)', tr.status, 201);
  const trId = tr.data?.id;
  check('SELLER POST /stock-transfers/:id/dispatch',    (await req('POST',`/stock-transfers/${trId}/dispatch`, T.SELLER, { deliveryId: s.delivery.id })).status, 200);
  check('SELLER POST /stock-transfers/:id/receive-all', (await req('POST',`/stock-transfers/${trId}/receive-all`, T.SELLER)).status, 200);
  const del = await req('POST','/stock-transfers/deliveries', T.SELLER, { name: 'Fletero SELLER', phone: '555' });
  check('SELLER POST /stock-transfers/deliveries',  del.status, 201);
  check('SELLER PATCH /stock-transfers/deliveries/:id', (await req('PATCH',`/stock-transfers/deliveries/${del.data?.id}`, T.SELLER, { phone: '556' })).status, 200);
  // cancelar un ítem de una transferencia recién creada
  const tr2 = await req('POST','/stock-transfers/items', T.SELLER, { inventoryItemId: s.itemsA[1].id, toTiendaId: B });
  const tr2ItemId = tr2.data?.transferItems?.[0]?.id;
  check('SELLER POST /stock-transfers/:id/items/:itemId/cancel', (await req('POST',`/stock-transfers/${tr2.data?.id}/items/${tr2ItemId}/cancel`, T.SELLER, { reason: 'test' })).status, 200);

  // Reparaciones
  const rep = await req('POST','/repairs', T.SELLER, { customerName: 'C', customerPhone: '1', deviceModel: 'iPhone 13', faultType: 'BATTERY', faultDescription: 'no carga' });
  check('SELLER POST /repairs', rep.status, 201);
  check('SELLER PUT  /repairs/:id',    (await req('PUT',`/repairs/${rep.data?.id}`, T.SELLER, { budget: 20000 })).status, 200);
  check('SELLER DELETE /repairs/:id',  (await req('DELETE',`/repairs/${rep.data?.id}`, T.SELLER)).status, 200);

  // Soporte
  check('SELLER POST /tickets', (await req('POST','/tickets', T.SELLER, { title: 't', description: 'd', category: 'CONSULTA_GENERAL' })).status, 201);

  // POS: crear venta necesita un carrito válido (fuera del alcance de este
  // script) — se verifica solo que el authz pasa (no 401/403).
  const posSale = await req('POST','/pos/sales', T.SELLER, {});
  checkTrue(`SELLER POST /pos/sales pasa authz (status ${posSale.status}, no 401/403)`, posSale.status !== 401 && posSale.status !== 403);

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
