/**
 * Verificación de autorización por rol — Vexio
 *
 * Levanta un tenant descartable (slug fijo `role-authz-test`, se borra y
 * recrea en cada corrida) con 3 sucursales (A, B, C) y usuarios
 * OWNER / SELLER_A / TECH_A / SELLER_B / SELLER_C / SELLER_SIN_SUCURSAL,
 * corre ~55 casos contra el backend local y borra todo al final (y también
 * si algo explota en el medio).
 *
 * Uso:  (con el backend corriendo en :3001, desde vexio-backend/)
 *   node role-authz-test.mjs
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
    await tx.cashMovement.deleteMany({ where: { tenantId } });
    await tx.sale.deleteMany({ where: { tenantId } });
    await tx.cashSession.deleteMany({ where: { tenantId } });
    await tx.purchaseOrder.deleteMany({ where: { tenantId } });
    await tx.payment.deleteMany({ where: { tenantId } });
    await tx.supplierPayment.deleteMany({ where: { tenantId } });
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
  const tiendaC = await prisma.tienda.create({ data: { name: 'Sucursal C', tenantId: tenant.id } });

  const mkUser = (email, role, tiendaId) =>
    prisma.user.create({ data: { email, name: email.split('@')[0], password: hashed, role, tenantId: tenant.id, tiendaId } });

  const owner    = await mkUser('owner@authztest.local',      'OWNER',  null);
  const sellerA  = await mkUser('seller-a@authztest.local',   'SELLER', tiendaA.id);
  const techA    = await mkUser('tech-a@authztest.local',     'TECH',   tiendaA.id);
  const sellerB  = await mkUser('seller-b@authztest.local',   'SELLER', tiendaB.id);
  const sellerC  = await mkUser('seller-c@authztest.local',   'SELLER', tiendaC.id);
  const sellerNo = await mkUser('seller-none@authztest.local','SELLER', null);

  const product = await prisma.product.create({ data: { name: 'iPhone Authz', color: 'Negro', storage: '128GB', minStock: 0, tenantId: tenant.id } });
  const mkItem = (imei, tiendaId) =>
    prisma.inventoryItem.create({
      data: { imei, condition: 'NEW', status: 'AVAILABLE', costPrice: 100, salePrice: 200, currencyCode: 'ARS', productId: product.id, tenantId: tenant.id, tiendaId },
    });
  const itemA1 = await mkItem('AUTHZ-A-1', tiendaA.id);
  const itemA2 = await mkItem('AUTHZ-A-2', tiendaA.id);
  const itemA3 = await mkItem('AUTHZ-A-3', tiendaA.id);
  const itemA4 = await mkItem('AUTHZ-A-4', tiendaA.id);
  const itemB1 = await mkItem('AUTHZ-B-1', tiendaB.id);

  const delivery = await prisma.delivery.create({ data: { name: 'Fletero Test', phone: '1122334455', tenantId: tenant.id } });

  return { tenant, tiendaA, tiendaB, tiendaC, owner, sellerA, techA, sellerB, sellerC, sellerNo,
           itemA1, itemA2, itemA3, itemA4, itemB1, delivery };
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

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[setup] creando tenant descartable con 3 sucursales...');
  const s = await setup();

  const T = {
    OWNER:     await login(s.owner.email),
    SELLER_A:  await login(s.sellerA.email),
    TECH_A:    await login(s.techA.email),
    SELLER_B:  await login(s.sellerB.email),
    SELLER_C:  await login(s.sellerC.email),
    SELLER_NO: await login(s.sellerNo.email),
  };

  // ═══ PARTE A — filtrado de módulos por rol (sesión 9) ═══════════════════════
  console.log('\n=== PARTE A: módulos por rol ===');

  check('TECH  GET  /cash/current',        (await req('GET','/cash/current?tiendaId='+s.tiendaA.id, T.TECH_A)).status, 403);
  check('TECH  GET  /cash/summary',        (await req('GET','/cash/summary?tiendaId='+s.tiendaA.id, T.TECH_A)).status, 403);
  check('TECH  POST /cash/open',           (await req('POST','/cash/open', T.TECH_A, { tiendaId: s.tiendaA.id })).status, 403);
  check('TECH  GET  /pos/search-item',     (await req('GET','/pos/search-item?q=a', T.TECH_A)).status, 403);
  check('TECH  POST /pos/sales',           (await req('POST','/pos/sales', T.TECH_A, {})).status, 403);
  check('TECH  GET  /pos/sales',           (await req('GET','/pos/sales', T.TECH_A)).status, 403);
  check('TECH  GET  /suppliers',           (await req('GET','/suppliers', T.TECH_A)).status, 403);
  check('TECH  GET  /suppliers/x',         (await req('GET','/suppliers/x', T.TECH_A)).status, 403);
  check('TECH  GET  /suppliers/x/orders',  (await req('GET','/suppliers/x/orders', T.TECH_A)).status, 403);
  check('TECH  GET  /stock-transfers (sin tiendaId = listado completo)', (await req('GET','/stock-transfers', T.TECH_A)).status, 403);
  check('TECH  GET  /repairs',             (await req('GET','/repairs', T.TECH_A)).status, 200);
  check('TECH  GET  /tickets',             (await req('GET','/tickets', T.TECH_A)).status, 200);
  check('TECH  GET  /notifications',       (await req('GET','/notifications', T.TECH_A)).status, 200);
  check('TECH  GET  /rates',               (await req('GET','/rates', T.TECH_A)).status, 200);
  check('TECH  GET  /inventory',           (await req('GET','/inventory', T.TECH_A)).status, 200);

  check('SELLER GET  /cash/current',       (await req('GET','/cash/current?tiendaId='+s.tiendaA.id, T.SELLER_A)).status, 200);
  check('SELLER GET  /pos/sales',          (await req('GET','/pos/sales', T.SELLER_A)).status, 200);
  check('SELLER GET  /suppliers',          (await req('GET','/suppliers', T.SELLER_A)).status, 200);
  check('SELLER GET  /notifications',      (await req('GET','/notifications', T.SELLER_A)).status, 200);
  check('SELLER GET  /suppliers/x',        (await req('GET','/suppliers/x', T.SELLER_A)).status, 403);
  check('SELLER POST /cash/open',          (await req('POST','/cash/open', T.SELLER_A, { tiendaId: s.tiendaA.id })).status, 403);
  check('SELLER GET  /stock-transfers (sin tiendaId = listado completo)', (await req('GET','/stock-transfers', T.SELLER_A)).status, 403);
  check('SELLER GET  /reports/sales',      (await req('GET','/reports/sales?from=2020-01-01&to=2030-01-01', T.SELLER_A)).status, 403);

  check('OWNER  GET  /pos/sales',          (await req('GET','/pos/sales', T.OWNER)).status, 200);
  check('OWNER  GET  /stock-transfers',    (await req('GET','/stock-transfers', T.OWNER)).status, 200);
  check('OWNER  GET  /suppliers',          (await req('GET','/suppliers', T.OWNER)).status, 200);
  check('OWNER  GET  /reports/sales',      (await req('GET','/reports/sales?from=2020-01-01&to=2030-01-01', T.OWNER)).status, 200);
  check('OWNER  GET  /tickets',            (await req('GET','/tickets', T.OWNER)).status, 200);

  // ═══ PARTE B — transferencias: SELLER/TECH por su propia sucursal ═══════════
  console.log('\n=== PARTE B: transferencias por sucursal ===');

  // Crear
  const create1 = await req('POST','/stock-transfers/items', T.SELLER_A, { inventoryItemId: s.itemA1.id, toTiendaId: s.tiendaB.id });
  check('SELLER_A crea transfer A->B (propia)', create1.status, 201);
  const transfer1Id = create1.data?.id;

  check('SELLER_B crea transfer sacando de A (ajena)',
    (await req('POST','/stock-transfers/items', T.SELLER_B, { inventoryItemId: s.itemA2.id, toTiendaId: s.tiendaB.id })).status, 403);

  check('TECH_A crea transfer A->B (propia)',
    (await req('POST','/stock-transfers/items', T.TECH_A, { inventoryItemId: s.itemA2.id, toTiendaId: s.tiendaB.id })).status, 201);

  check('SELLER_NO (sin sucursal) crea transfer',
    (await req('POST','/stock-transfers/items', T.SELLER_NO, { inventoryItemId: s.itemA3.id, toTiendaId: s.tiendaB.id })).status, 403);

  // Despachar (origen)
  check('SELLER_A despacha su lote (origen)',
    (await req('POST',`/stock-transfers/${transfer1Id}/dispatch`, T.SELLER_A, { deliveryId: s.delivery.id })).status, 200);

  // Recibir (destino)
  check('TECH_A recibe lote destinado a B (ajena)',
    (await req('POST',`/stock-transfers/${transfer1Id}/receive-all`, T.TECH_A)).status, 403);
  check('SELLER_B recibe lote en B (destino propio)',
    (await req('POST',`/stock-transfers/${transfer1Id}/receive-all`, T.SELLER_B)).status, 200);

  // Listado: completo (sin tiendaId) solo OWNER/ADMIN; con ?tiendaId propia OK; ajena 403
  check('SELLER_A GET /stock-transfers (sin tiendaId)',              (await req('GET','/stock-transfers', T.SELLER_A)).status, 403);
  check('TECH_A   GET /stock-transfers (sin tiendaId)',              (await req('GET','/stock-transfers', T.TECH_A)).status, 403);
  const listAOwn = await req('GET','/stock-transfers?tiendaId='+s.tiendaA.id, T.SELLER_A);
  check('SELLER_A GET /stock-transfers?tiendaId=propia',             listAOwn.status, 200);
  check('SELLER_A GET /stock-transfers?tiendaId=ajena (B)',          (await req('GET','/stock-transfers?tiendaId='+s.tiendaB.id, T.SELLER_A)).status, 403);
  check('TECH_A   GET /stock-transfers?tiendaId=propia',             (await req('GET','/stock-transfers?tiendaId='+s.tiendaA.id, T.TECH_A)).status, 200);

  // Contenido del listado scopeado: SELLER_B arma un B->C que NO toca A.
  const bc = await req('POST','/stock-transfers/items', T.SELLER_B, { inventoryItemId: s.itemB1.id, toTiendaId: s.tiendaC.id });
  check('SELLER_B crea transfer B->C (origen propio)', bc.status, 201);
  const bcId = bc.data?.id;
  const ownerFull = await req('GET','/stock-transfers', T.OWNER);
  checkTrue('OWNER ve el B->C en el listado completo', (ownerFull.data?.transfers ?? []).some((t) => t.id === bcId));
  const listAOwn2 = await req('GET','/stock-transfers?tiendaId='+s.tiendaA.id, T.SELLER_A);
  const rowsA = listAOwn2.data?.transfers ?? [];
  checkTrue('SELLER_A NO ve el B->C en su listado scopeado', !rowsA.some((t) => t.id === bcId));
  checkTrue('SELLER_A: todas las filas de su listado tocan la sucursal A',
    rowsA.length > 0 && rowsA.every((t) => t.fromTienda?.id === s.tiendaA.id || t.toTienda?.id === s.tiendaA.id));

  // Cancelar una transferencia ya creada → solo OWNER/ADMIN
  const create5 = await req('POST','/stock-transfers/items', T.TECH_A, { inventoryItemId: s.itemA3.id, toTiendaId: s.tiendaB.id });
  const transfer2Id = create5.data?.id;
  const item2 = create5.data?.transferItems?.[0]?.id;
  check('SELLER_A cancela ítem de transfer (ya creada)', (await req('POST',`/stock-transfers/${transfer2Id}/items/${item2}/cancel`, T.SELLER_A, { reason: 'test' })).status, 403);
  check('TECH_A   cancela ítem de transfer (ya creada)', (await req('POST',`/stock-transfers/${transfer2Id}/items/${item2}/cancel`, T.TECH_A, { reason: 'test' })).status, 403);
  check('OWNER    cancela ítem de transfer (ya creada)', (await req('POST',`/stock-transfers/${transfer2Id}/items/${item2}/cancel`, T.OWNER, { reason: 'test' })).status, 200);

  // Ver una transferencia puntual (assertTiendaAccess adentro)
  check('SELLER_B  GET /stock-transfers/:id (destino propio)',  (await req('GET',`/stock-transfers/${transfer1Id}`, T.SELLER_B)).status, 200);
  check('SELLER_C  GET /stock-transfers/:id (ajena)',           (await req('GET',`/stock-transfers/${transfer1Id}`, T.SELLER_C)).status, 403);
  check('SELLER_NO GET /stock-transfers/:id (ninguna suya)',    (await req('GET',`/stock-transfers/${transfer1Id}`, T.SELLER_NO)).status, 403);

  // ABM del catálogo de fleteros → solo OWNER/ADMIN
  check('SELLER_A POST /stock-transfers/deliveries', (await req('POST','/stock-transfers/deliveries', T.SELLER_A, { name: 'x', phone: '123' })).status, 403);
  check('SELLER_A GET  /stock-transfers/deliveries (lo precisa el dispatch)', (await req('GET','/stock-transfers/deliveries', T.SELLER_A)).status, 200);
  check('OWNER    POST /stock-transfers/deliveries', (await req('POST','/stock-transfers/deliveries', T.OWNER, { name: 'Fletero 2', phone: '999' })).status, 201);

  // Segunda vía de "crear": armar lote nuevo desde la propia sucursal
  check('SELLER_A crea 2do transfer A->B (propia)',
    (await req('POST','/stock-transfers/items', T.SELLER_A, { inventoryItemId: s.itemA4.id, toTiendaId: s.tiendaB.id })).status, 201);

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
