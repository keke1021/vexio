// Fase 1 — bootstrap del tenant de prueba.
//
// Todo esto pasa por los endpoints reales de /admin (como SUPERADMIN) y
// después por los endpoints normales del tenant (como su propio OWNER) —
// no hay valor de concurrencia acá (es alta única, no concurrente), así que
// se usa el mismo criterio que seed-demo.js para la única parte que SÍ
// necesita escritura directa: ante-datar los timestamps al día simulado 0
// una vez que todo ya se creó por HTTP.
//
// CUIDADO DE SEGURIDAD: la sesión de SUPERADMIN se usa EXCLUSIVAMENTE para
// rutas /admin/tenants/** (crear tenant, tiendas, usuarios). Para cualquier
// operación dentro del tenant (proveedores, inventario, ventas, caja) se usa
// siempre el token del OWNER o de un empleado DEL TENANT NUEVO — nunca el de
// SUPERADMIN, porque authorize() lo deja pasar en cualquier ruta pero
// req.user.tenantId seguiría siendo el de SyntraTech, y terminaríamos
// escribiendo datos de prueba en el tenant real.

const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const fs = require('fs');

const config = require('./config');
const { Session } = require('./lib/api-client');
const { makeRng } = require('./lib/prng');
const { PRODUCTS, currencyForProductIdx, priceForCurrency, CONDITION_WEIGHTS } = require('./lib/catalog');

const prisma = new PrismaClient();

const buildRestockXlsx = (rows) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

const buildInventoryRows = (rng, tiendaKey, count, imeiPrefix) => {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const p = PRODUCTS[i % PRODUCTS.length];
    const currency = currencyForProductIdx(i % PRODUCTS.length);
    const condition = rng.pickWeighted(CONDITION_WEIGHTS);
    const salePrice = priceForCurrency(rng, currency, condition);
    const costPrice = parseFloat((salePrice * rng.randFloat(0.62, 0.8)).toFixed(2));
    rows.push({
      modelo: p.name,
      color: p.color,
      almacenamiento: p.storage,
      condicion: condition.toLowerCase(),
      costo: costPrice,
      precio_venta: salePrice,
      imei: `${imeiPrefix}-${tiendaKey}-${String(i).padStart(4, '0')}`,
      notas: '',
      moneda: currency,
      proveedor: '',
    });
  }
  return rows;
};

async function uploadInventoryBatch(ownerSession, tiendaId, rows, meta) {
  const buf = buildRestockXlsx(rows);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/octet-stream' }), 'stock.xlsx');
  form.append('tiendaId', tiendaId);
  const res = await ownerSession.postForm('/inventory/bulk-upload', form, meta);
  if (!res.ok || res.body?.failed > 0) {
    console.warn(`[bootstrap] bulk-upload con errores en ${tiendaId}:`, res.status, JSON.stringify(res.body).slice(0, 500));
  }
  return res;
}

async function run() {
  console.log(`[bootstrap] Creando tenant de stress test: ${config.TENANT.tenantSlug}`);

  const sa = new Session('SUPERADMIN');
  await sa.login(config.SUPERADMIN.email, config.SUPERADMIN.password);
  if (sa.role !== 'SUPERADMIN') {
    throw new Error(`[bootstrap] La cuenta ${config.SUPERADMIN.email} no es SUPERADMIN (role=${sa.role}) — abortando.`);
  }

  // ── Tenant + OWNER ──────────────────────────────────────────────────────
  const tenantRes = await sa.post('/admin/tenants', {
    tenantName: config.TENANT.tenantName,
    tenantSlug: config.TENANT.tenantSlug,
    email: config.TENANT.email,
    password: config.TENANT.password,
    name: config.TENANT.name,
    maxUsers: config.TENANT.maxUsers,
  }, { phase: 'bootstrap', step: 'create-tenant' });
  if (!tenantRes.ok) throw new Error(`[bootstrap] createTenant falló: ${JSON.stringify(tenantRes.body)}`);

  const tenantId = tenantRes.body.tenant.id;
  const ownerId = tenantRes.body.user.id;
  console.log(`[bootstrap] Tenant creado: ${tenantId}`);

  // ── Tiendas ──────────────────────────────────────────────────────────────
  const tiendas = [];
  for (const t of config.TIENDAS) {
    const r = await sa.post(`/admin/tenants/${tenantId}/tiendas`, { name: t.name, address: t.address }, { phase: 'bootstrap', step: 'create-tienda' });
    if (!r.ok) throw new Error(`[bootstrap] createTienda(${t.name}) falló: ${JSON.stringify(r.body)}`);
    tiendas.push({ key: t.key, id: r.body.id, name: r.body.name });
  }
  console.log(`[bootstrap] Tiendas creadas: ${tiendas.map((t) => t.name).join(', ')}`);

  // ── Empleados (rol ADMIN — ver comentario de config.js) ─────────────────
  const employees = [];
  for (let i = 0; i < config.EMPLOYEES.length; i++) {
    const e = config.EMPLOYEES[i];
    const homeTienda = tiendas[i % tiendas.length];
    const r = await sa.post(`/admin/tenants/${tenantId}/users`, {
      name: e.name, email: e.email, password: config.EMPLOYEE_PASSWORD,
      role: config.EMPLOYEE_ROLE, tiendaId: homeTienda.id,
    }, { phase: 'bootstrap', step: 'create-employee' });
    if (!r.ok) throw new Error(`[bootstrap] createTenantUser(${e.email}) falló: ${JSON.stringify(r.body)}`);
    employees.push({ key: e.key, id: r.body.id, name: e.name, email: e.email, password: config.EMPLOYEE_PASSWORD, homeTiendaId: homeTienda.id });
  }
  console.log(`[bootstrap] Empleados creados (rol ${config.EMPLOYEE_ROLE}): ${employees.map((e) => e.email).join(', ')}`);

  // ── Login como OWNER y como cada empleado — de acá en más, SIEMPRE se usa
  // uno de estos tokens para operar dentro del tenant, nunca el de SA ──────
  const ownerSession = new Session('OWNER');
  await ownerSession.login(config.TENANT.email, config.TENANT.password);

  const employeeSessions = {};
  for (const e of employees) {
    const s = new Session(e.key);
    await s.login(e.email, e.password);
    employeeSessions[e.key] = s;
  }

  // ── Proveedores iniciales ────────────────────────────────────────────────
  const suppliers = [];
  for (const s of config.SUPPLIERS_INITIAL) {
    const r = await ownerSession.post('/suppliers', {
      name: s.name, city: s.city, paymentDays: s.paymentDays, phone: s.phone, email: s.email,
    }, { phase: 'bootstrap', step: 'create-supplier' });
    if (!r.ok) throw new Error(`[bootstrap] createSupplier(${s.name}) falló: ${JSON.stringify(r.body)}`);
    suppliers.push({ id: r.body.id, name: s.name, currency: s.currency });
  }
  console.log(`[bootstrap] Proveedores creados: ${suppliers.map((s) => s.name).join(', ')}`);

  // ── Inventario inicial — runway objetivo de RESTOCK_RUNWAY_DAYS + 2 días
  // por tienda, dimensionado desde el volumen esperado de ventas/día ───────
  const avgSalesPerDay = (config.SALES_PER_DAY.min + config.SALES_PER_DAY.max) / 2;
  const avgSalesPerDayPerTienda = avgSalesPerDay / tiendas.length;
  const initialUnitsPerTienda = Math.ceil(avgSalesPerDayPerTienda * (config.RESTOCK_RUNWAY_DAYS + 2));

  const rng = makeRng(42);
  for (const t of tiendas) {
    const rows = buildInventoryRows(rng, t.key, initialUnitsPerTienda, 'VXBOOT');
    await uploadInventoryBatch(ownerSession, t.id, rows, { phase: 'bootstrap', step: 'initial-inventory', tiendaKey: t.key });
  }
  console.log(`[bootstrap] Inventario inicial cargado: ~${initialUnitsPerTienda} unidades por tienda.`);

  // ── Ante-datar todo el bootstrap al día simulado 0 ──────────────────────
  // Escritura directa vía Prisma, mismo patrón que seed-demo.js — no hay
  // endpoint que acepte createdAt custom, y acá no hace falta: es alta
  // única, sin concurrencia que probar.
  await prisma.$transaction([
    prisma.tenant.update({ where: { id: tenantId }, data: { createdAt: config.SIM_START } }),
    prisma.tienda.updateMany({ where: { tenantId }, data: { createdAt: config.SIM_START } }),
    prisma.user.updateMany({ where: { tenantId }, data: { createdAt: config.SIM_START } }),
    prisma.supplier.updateMany({ where: { tenantId }, data: { createdAt: config.SIM_START } }),
    prisma.product.updateMany({ where: { tenantId }, data: { createdAt: config.SIM_START } }),
    prisma.inventoryItem.updateMany({ where: { tenantId, imei: { startsWith: 'VXBOOT-' } }, data: { createdAt: config.SIM_START } }),
  ]);
  console.log(`[bootstrap] Timestamps de bootstrap fijados a ${config.SIM_START.toISOString()} (día simulado 0).`);

  const state = {
    tenantId,
    tenantSlug: config.TENANT.tenantSlug,
    simStart: config.SIM_START.toISOString(),
    simDays: config.SIM_DAYS,
    owner: { id: ownerId, email: config.TENANT.email, password: config.TENANT.password },
    tiendas,
    employees,
    suppliers,
  };

  fs.mkdirSync(config.OUT_DIR, { recursive: true });
  fs.writeFileSync(config.LAST_RUN_FILE, JSON.stringify(state, null, 2));

  return { ...state, sessions: { sa, owner: ownerSession, employees: employeeSessions } };
}

module.exports = { run, buildInventoryRows, buildRestockXlsx, uploadInventoryBatch };

if (require.main === module) {
  run()
    .then((state) => {
      console.log('\n[bootstrap] Listo:', state.tenantId);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[bootstrap] ERROR:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
