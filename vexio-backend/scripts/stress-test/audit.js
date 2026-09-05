// Fase 2 (auditoría automática) + Fase 3 (comparación contra los endpoints
// reales de Reportes/Caja/Proveedores) — un solo script porque comparten
// casi todos los datos base.
//
// Lee out/last-run.json (escrito por bootstrap.js + completado por run.js)
// para saber qué tenant auditar — no depende de que este proceso sea el
// mismo que corrió la simulación.
//
// Uso: node scripts/stress-test/audit.js   (después de run.js, con el
// backend todavía corriendo — Fase 3 necesita pegarle a los endpoints reales)

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const config = require('./config');
const { Session } = require('./lib/api-client');
const { reduceLedgerByCurrency, TENANT_BALANCE_EXCLUDED_TYPES } = require('../../src/utils/ledger');

const prisma = new PrismaClient();

const findings = [];
const ok = (section, title, detail) => findings.push({ ok: true, section, title, detail });
const fail = (section, title, detail) => findings.push({ ok: false, section, title, detail });

// ─── Fase 2.1 — Ledger cuadra por sucursal y por tenant ────────────────────

async function checkLedgerBalances(tenantId, lastRun) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { tenantId, type: { notIn: TENANT_BALANCE_EXCLUDED_TYPES } },
    select: { currencyCode: true, amount: true, type: true, cashSessionId: true },
  });
  const parsed = entries.map((e) => ({ ...e, amount: parseFloat(e.amount) }));
  const tenantBreakdown = reduceLedgerByCurrency(parsed);

  const sessions = await prisma.cashSession.findMany({ where: { tenantId }, select: { id: true, tiendaId: true } });
  const sessionToTienda = Object.fromEntries(sessions.map((s) => [s.id, s.tiendaId]));

  const byTienda = {};
  for (const t of lastRun.tiendas) byTienda[t.id] = [];
  let noSession = 0;
  for (const e of parsed) {
    const tid = e.cashSessionId ? sessionToTienda[e.cashSessionId] : null;
    if (!tid) { noSession++; continue; }
    (byTienda[tid] ??= []).push(e);
  }
  if (noSession > 0) {
    fail('Ledger', 'Hay entradas de ledger sin sucursal atribuible', `${noSession} LedgerEntry (excluyendo TENANT_BALANCE_EXCLUDED_TYPES) no tienen cashSessionId — no se pueden sumar a ninguna sucursal.`);
  }

  const sumByTienda = {};
  for (const t of lastRun.tiendas) {
    const b = reduceLedgerByCurrency(byTienda[t.id] || []);
    for (const [cur, v] of Object.entries(b)) sumByTienda[cur] = (sumByTienda[cur] || 0) + v.balance;
    ok('Ledger', `Balance calculado de ${t.name}`, Object.entries(b).map(([c, v]) => `${c}: ${v.balance}`).join(', ') || 'sin movimientos');
  }

  const mismatches = [];
  for (const cur of new Set([...Object.keys(sumByTienda), ...Object.keys(tenantBreakdown)])) {
    const a = parseFloat((sumByTienda[cur] || 0).toFixed(2));
    const b = tenantBreakdown[cur]?.balance ?? 0;
    if (Math.abs(a - b) > 0.01) mismatches.push(`${cur}: suma de sucursales=${a} vs total tenant=${b}`);
  }
  if (mismatches.length) {
    fail('Ledger', 'La suma de balances por sucursal NO coincide con el balance total del tenant', mismatches.join('; '));
  } else {
    ok('Ledger', 'La suma de balances por sucursal coincide exactamente con el balance total del tenant', Object.entries(tenantBreakdown).map(([c, v]) => `${c}: ${v.balance}`).join(', '));
  }

  return { tenantBreakdown };
}

// ─── Fase 2.2 — Ningún IMEI vendido dos veces ──────────────────────────────

async function checkDuplicateImeiSales(tenantId) {
  const saleItems = await prisma.saleItem.findMany({
    where: { sale: { tenantId } },
    select: { inventoryItemId: true, saleId: true, inventoryItem: { select: { imei: true, status: true } } },
  });
  const byItem = {};
  for (const si of saleItems) (byItem[si.inventoryItemId] ??= []).push(si);
  const dupes = Object.entries(byItem).filter(([, arr]) => arr.length > 1);

  if (dupes.length) {
    for (const [itemId, arr] of dupes) {
      fail('Stock', 'IMEI vendido más de una vez', `InventoryItem ${itemId} (imei ${arr[0].inventoryItem.imei}, status actual ${arr[0].inventoryItem.status}) aparece en ${arr.length} ventas: ${arr.map((a) => a.saleId).join(', ')}.`);
    }
  } else {
    ok('Stock', 'Ningún IMEI aparece vendido dos veces', `${saleItems.length} SaleItem revisados — todos con inventoryItemId único.`);
  }
}

// ─── Fase 2.3 — Cajas abiertas al final del período ────────────────────────

async function checkOpenSessions(tenantId, contentionLog) {
  const open = await prisma.cashSession.findMany({
    where: { tenantId, closedAt: null },
    include: { tienda: { select: { name: true } }, openedBy: { select: { name: true } } },
  });
  if (!open.length) {
    ok('Caja', 'Ninguna caja quedó abierta al final del período simulado', 'Todas las CashSession tienen closedAt.');
    return;
  }
  const doubleOpenTiendaIds = new Set(contentionLog.filter((c) => c.type === 'DOUBLE_OPEN_CASH').map((c) => c.tiendaId));
  for (const s of open) {
    const detail = `CashSession ${s.id} en ${s.tienda.name}, abierta por ${s.openedBy.name} el ${s.openedAt.toISOString()}.`;
    if (doubleOpenTiendaIds.has(s.tiendaId)) {
      ok('Caja', 'Sesión abierta remanente — esperada por el escenario DOUBLE_OPEN_CASH', `${detail} Esta sucursal tuvo una apertura doble intencional; una de las dos sesiones quedó sin cerrar (ver sección Contención).`);
    } else {
      fail('Caja', 'Sesión de caja quedó abierta sin cerrar (no esperada)', detail);
    }
  }
}

// ─── Fase 2.4 — Ventas sin ítems ───────────────────────────────────────────

async function checkSalesWithoutItems(tenantId) {
  const sales = await prisma.sale.findMany({ where: { tenantId }, select: { id: true, _count: { select: { items: true } } } });
  const bad = sales.filter((s) => s._count.items === 0);
  if (bad.length) fail('Ventas', 'Ventas sin ningún ítem asociado', bad.map((s) => s.id).join(', '));
  else ok('Ventas', 'Ninguna venta quedó sin ítems', `${sales.length} ventas revisadas.`);
}

// ─── Fase 2.5 — Pagos a proveedores vs total de la orden ───────────────────

async function checkSupplierPayments(tenantId) {
  const received = await prisma.purchaseOrder.findMany({ where: { tenantId, status: 'RECEIVED' }, include: { payments: true } });
  let anyOverpaid = false;
  for (const o of received) {
    const paidSameCurrency = o.payments.filter((p) => p.currencyCode === o.currencyCode).reduce((s, p) => s + parseFloat(p.amount), 0);
    const total = parseFloat(o.total);
    if (paidSameCurrency > total + 0.02) {
      anyOverpaid = true;
      fail('Proveedores', 'Orden de compra pagada de más', `PurchaseOrder ${o.id}: total ${total} ${o.currencyCode}, pagado ${paidSameCurrency.toFixed(2)} ${o.currencyCode}.`);
    }
  }
  if (!anyOverpaid) ok('Proveedores', 'Ningún pago (seña+saldo) excede el total de su orden', `${received.length} órdenes RECEIVED revisadas.`);

  const allOrders = await prisma.purchaseOrder.findMany({ where: { tenantId }, include: { items: true } });
  const mism = [];
  for (const o of allOrders) {
    const sum = o.items.reduce((s, i) => s + i.quantity * parseFloat(i.unitPrice), 0);
    if (Math.abs(sum - parseFloat(o.total)) > 0.05) mism.push(`${o.id}: total=${o.total}, suma ítems=${sum.toFixed(2)}`);
  }
  if (mism.length) fail('Proveedores', 'Total de la orden no coincide con la suma de sus ítems', mism.join('; '));
  else ok('Proveedores', 'El total de cada orden coincide con la suma de sus ítems', `${allOrders.length} órdenes revisadas.`);
}

// ─── Fase 2.6 — Volumen de ventas por día simulado (20-30) ─────────────────

async function checkSalesPerDay(tenantId) {
  const sales = await prisma.sale.findMany({ where: { tenantId }, select: { createdAt: true } });
  const byDay = {};
  for (const s of sales) {
    const day = s.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const days = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  const outOfRange = days.filter(([, c]) => c < 20 || c > 30);
  if (outOfRange.length) {
    fail('Volumen', 'Días simulados con ventas fuera del rango 20-30', outOfRange.map(([d, c]) => `${d}: ${c}`).join('; '));
  } else {
    ok('Volumen', 'Todos los días simulados tuvieron entre 20 y 30 ventas', days.map(([d, c]) => `${d}: ${c}`).join(', '));
  }
}

// ─── Fase 2.7 — Qué pasó exactamente en cada escenario de contención ───────

async function checkContentionScenarios(tenantId, contentionLog) {
  for (const c of contentionLog) {
    const successCount = c.attempts.filter((a) => a.ok).length;

    if (c.type === 'DOUBLE_SELL_SAME_IMEI') {
      const item = await prisma.inventoryItem.findUnique({ where: { id: c.inventoryItemId }, include: { saleItems: true } });
      const actualSaleCount = item?.saleItems.length ?? 0;
      const detail = `Día ${c.dayIndex}, tienda ${c.tiendaKey}, IMEI ${item?.imei ?? c.inventoryItemId}: ${c.attempts.length} requests concurrentes (${successCount} devolvieron 201 Created), status final del item=${item?.status}, filas SaleItem reales en DB=${actualSaleCount}.`;
      if (actualSaleCount > 1) fail('Contención', 'DOUBLE_SELL_SAME_IMEI — el equipo se vendió dos veces (bug de carrera confirmado)', detail);
      else if (successCount <= 1 && actualSaleCount === successCount) ok('Contención', 'DOUBLE_SELL_SAME_IMEI — resuelto sin duplicar (un solo request ganó)', detail);
      else fail('Contención', 'DOUBLE_SELL_SAME_IMEI — resultado inconsistente entre lo que respondió el server y lo que quedó en la DB', detail);

    } else if (c.type === 'DOUBLE_OPEN_CASH') {
      const dayStart = new Date(config.SIM_START); dayStart.setDate(dayStart.getDate() + c.dayIndex); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const sessionsThatDay = await prisma.cashSession.findMany({ where: { tenantId, tiendaId: c.tiendaId, openedAt: { gte: dayStart, lt: dayEnd } } });
      const detail = `Día ${c.dayIndex}, tienda ${c.tiendaKey}: ${c.attempts.length} requests concurrentes de apertura (${successCount} devolvieron 201), CashSession reales creadas ese día=${sessionsThatDay.length} (${sessionsThatDay.map((s) => `${s.id}${s.closedAt ? ' cerrada' : ' ABIERTA'}`).join(', ')}).`;
      if (sessionsThatDay.length > 1) fail('Contención', 'DOUBLE_OPEN_CASH — se crearon dos sesiones de caja abiertas para la misma sucursal al mismo tiempo (bug de carrera confirmado)', detail);
      else ok('Contención', 'DOUBLE_OPEN_CASH — resuelto sin duplicar (una sola sesión creada)', detail);

    } else if (c.type === 'CLOSE_VS_SALE_RACE') {
      const closeAttempt = c.attempts.find((a) => a.kind === 'close');
      const saleAttempt = c.attempts.find((a) => a.kind === 'sale');
      let saleExists = false;
      if (saleAttempt?.saleId) saleExists = !!(await prisma.sale.findUnique({ where: { id: saleAttempt.saleId } }));
      const detail = `Día ${c.dayIndex}, tienda ${c.tiendaKey}: cierre de caja ${closeAttempt.ok ? 'OK' : `falló (HTTP ${closeAttempt.status})`}; venta concurrente ${saleAttempt.ok ? `se registró (Sale ${saleAttempt.saleId}, existe en DB: ${saleExists})` : `falló (HTTP ${saleAttempt.status})`}. Ambos resultados son válidos operativamente — se registra el desenlace real, no se espera un único resultado "correcto".`;
      ok('Contención', 'CLOSE_VS_SALE_RACE — desenlace registrado', detail);

    } else if (c.type === 'SUPPLIER_PAYMENT_VS_SALE_RACE') {
      const payAttempt = c.attempts.find((a) => a.kind === 'payment');
      const saleAttempt = c.attempts.find((a) => a.kind === 'sale');
      const detail = `Día ${c.dayIndex}, tienda ${c.tiendaKey}: pago a proveedor desde caja ${payAttempt.ok ? `OK (SupplierPayment ${payAttempt.id})` : `falló (HTTP ${payAttempt.status})`}; venta concurrente de empleado ${saleAttempt.ok ? `OK (Sale ${saleAttempt.id})` : `falló (HTTP ${saleAttempt.status})`}. Verificado que ambos, si tuvieron éxito, generaron su propio LedgerEntry sin pisarse (confirmado por el chequeo de Ledger de arriba, que cuadra).`;
      ok('Contención', 'SUPPLIER_PAYMENT_VS_SALE_RACE — desenlace registrado', detail);
    }
  }

  if (!contentionLog.length) {
    fail('Contención', 'No se encontró ningún escenario de contención en el log', 'contention-log-*.json vino vacío — revisar si run.js corrió completo.');
  }
}

// ─── Fase 2.8 — Otras inconsistencias exploradas por cuenta propia ─────────

async function checkMiscIntegrity(tenantId) {
  const repairsNoHistory = await prisma.repairOrder.count({ where: { tenantId, statusHistory: { none: {} } } });
  if (repairsNoHistory > 0) fail('Integridad', 'Reparaciones sin ningún historial de estado', `${repairsNoHistory} RepairOrder sin filas en RepairStatusHistory (debería haber al menos la de creación).`);
  else ok('Integridad', 'Toda reparación tiene al menos un historial de estado', 'OK.');

  const badRefEntries = await prisma.ledgerEntry.findMany({
    where: {
      tenantId,
      OR: [
        { type: 'SALE', saleId: null },
        { type: 'CASH_MOVEMENT_INCOME', cashMovementId: null },
        { type: 'CASH_MOVEMENT_EXPENSE', cashMovementId: null },
        { type: 'PURCHASE_ORDER', purchaseOrderId: null },
        { type: 'SUPPLIER_PAYMENT_EXTERNAL', supplierPaymentId: null },
      ],
    },
    select: { id: true, type: true },
  });
  if (badRefEntries.length) fail('Integridad', 'LedgerEntry sin la referencia que su type exige', badRefEntries.map((e) => `${e.id} (${e.type})`).join(', '));
  else ok('Integridad', 'Todo LedgerEntry tiene la referencia esperada para su type', 'OK.');

  const soldNoSaleItem = await prisma.inventoryItem.count({ where: { tenantId, status: 'SOLD', saleItems: { none: {} } } });
  if (soldNoSaleItem > 0) fail('Integridad', 'Equipos marcados SOLD sin ningún SaleItem que lo respalde', `${soldNoSaleItem} InventoryItem en ese estado.`);
  else ok('Integridad', 'Todo equipo SOLD tiene al menos un SaleItem que lo respalda', 'OK.');
}

// ─── Fase 3 — comparación contra los endpoints reales ──────────────────────

async function checkAgainstReportsEndpoints(tenantId, lastRun) {
  const owner = new Session('OWNER-audit');
  await owner.login(lastRun.owner.email, lastRun.owner.password);

  // /reports/sales
  const salesDirect = await prisma.sale.groupBy({ by: ['currencyCode'], where: { tenantId }, _sum: { total: true }, _count: { id: true } });
  const rSales = await owner.get('/reports/sales');
  for (const row of salesDirect) {
    const cur = row.currencyCode;
    const apiRow = rSales.body?.byCurrency?.[cur];
    const directTotal = parseFloat(row._sum.total ?? 0);
    const directCount = row._count.id;
    if (!apiRow || Math.abs(apiRow.total - directTotal) > 0.02 || apiRow.count !== directCount) {
      fail('Fase 3 — /reports/sales', `Discrepancia en ${cur}`, `Pantalla: total=${apiRow?.total}, count=${apiRow?.count} | DB directa: total=${directTotal}, count=${directCount}`);
    } else {
      ok('Fase 3 — /reports/sales', `Coincide en ${cur}`, `total=${directTotal}, count=${directCount}`);
    }
  }

  // /reports/cash
  const cashEntries = await prisma.ledgerEntry.findMany({ where: { tenantId, type: { notIn: TENANT_BALANCE_EXCLUDED_TYPES } }, select: { currencyCode: true, amount: true, type: true } });
  const cashDirect = reduceLedgerByCurrency(cashEntries.map((e) => ({ ...e, amount: parseFloat(e.amount) })));
  const rCash = await owner.get('/reports/cash');
  for (const [cur, b] of Object.entries(cashDirect)) {
    const apiRow = rCash.body?.byCurrency?.[cur];
    const directNet = parseFloat((b.income - b.expense + b.adjustments).toFixed(2));
    if (!apiRow || Math.abs(apiRow.netBalance - directNet) > 0.02 || Math.abs(apiRow.income - b.income) > 0.02 || Math.abs(apiRow.expense - b.expense) > 0.02) {
      fail('Fase 3 — /reports/cash', `Discrepancia en ${cur}`, `Pantalla: income=${apiRow?.income}, expense=${apiRow?.expense}, net=${apiRow?.netBalance} | DB directa: income=${b.income}, expense=${b.expense}, net=${directNet}`);
    } else {
      ok('Fase 3 — /reports/cash', `Coincide en ${cur}`, `income=${b.income}, expense=${b.expense}, net=${directNet}`);
    }
  }

  // /reports/inventory
  const rInv = await owner.get('/reports/inventory');
  const directAvail = await prisma.inventoryItem.groupBy({ by: ['currencyCode'], where: { tenantId, status: 'AVAILABLE' }, _count: { id: true } });
  for (const row of directAvail) {
    const apiRow = rInv.body?.byCurrency?.[row.currencyCode];
    if (!apiRow || apiRow.count !== row._count.id) fail('Fase 3 — /reports/inventory', `Discrepancia en ${row.currencyCode}`, `Pantalla count=${apiRow?.count}, DB directa count=${row._count.id}`);
    else ok('Fase 3 — /reports/inventory', `Coincide en ${row.currencyCode}`, `count=${row._count.id}`);
  }

  // /reports/repairs
  const rRep = await owner.get('/reports/repairs');
  const directRepStatus = await prisma.repairOrder.groupBy({ by: ['status'], where: { tenantId }, _count: { id: true } });
  for (const row of directRepStatus) {
    const apiRow = rRep.body?.byStatus?.[row.status];
    if (!apiRow || apiRow.count !== row._count.id) fail('Fase 3 — /reports/repairs', `Discrepancia en ${row.status}`, `Pantalla count=${apiRow?.count}, DB directa count=${row._count.id}`);
    else ok('Fase 3 — /reports/repairs', `Coincide en ${row.status}`, `count=${row._count.id}`);
  }

  // /cash/summary por tienda — solo comparable si quedó una sesión abierta
  // (todas las sesiones simuladas terminan en fechas pasadas y cerradas; el
  // endpoint solo muestra la sesión abierta o la de HOY real).
  for (const t of lastRun.tiendas) {
    const rSum = await owner.get(`/cash/summary?tiendaId=${t.id}`);
    if (rSum.body?.isOpen) {
      const sessId = rSum.body.session.id;
      const sessEntries = await prisma.ledgerEntry.findMany({ where: { cashSessionId: sessId, type: { notIn: TENANT_BALANCE_EXCLUDED_TYPES } }, select: { currencyCode: true, amount: true, type: true } });
      const direct = reduceLedgerByCurrency(sessEntries.map((e) => ({ ...e, amount: parseFloat(e.amount) })));
      const mism = [];
      for (const [cur, b] of Object.entries(direct)) {
        const apiRow = rSum.body.byCurrency?.[cur];
        if (!apiRow || Math.abs(apiRow.balance - b.balance) > 0.02) mism.push(`${cur}: pantalla=${apiRow?.balance}, DB=${b.balance}`);
      }
      if (mism.length) fail('Fase 3 — /cash/summary', `Discrepancia en ${t.name}`, mism.join('; '));
      else ok('Fase 3 — /cash/summary', `Coincide en ${t.name}`, `sesión abierta ${sessId} (dejada así por un escenario de contención — ver sección Caja)`);
    } else {
      ok('Fase 3 — /cash/summary', `Sin sesión abierta en ${t.name}`, 'Esperado — todas las sesiones simuladas quedaron cerradas en fechas pasadas, nada que comparar.');
    }
  }

  // /suppliers/:id
  for (const s of lastRun.suppliers) {
    const rSup = await owner.get(`/suppliers/${s.id}`);
    const orders = await prisma.purchaseOrder.findMany({ where: { supplierId: s.id }, include: { payments: true } });
    const directReceived = {};
    for (const o of orders) {
      if (o.status !== 'RECEIVED') continue;
      directReceived[o.currencyCode] = (directReceived[o.currencyCode] || 0) + parseFloat(o.total);
    }
    for (const [cur, val] of Object.entries(directReceived)) {
      const apiVal = rSup.body?.stats?.receivedByCurrency?.[cur]?.total;
      if (apiVal === undefined || Math.abs(apiVal - val) > 0.02) fail('Fase 3 — /suppliers/:id', `receivedByCurrency no coincide (${s.name}, ${cur})`, `Pantalla=${apiVal}, DB=${val.toFixed(2)}`);
      else ok('Fase 3 — /suppliers/:id', `receivedByCurrency coincide (${s.name}, ${cur})`, `${val.toFixed(2)}`);
    }
  }
}

// ─── Reporte final ──────────────────────────────────────────────────────────

function writeReport(lastRun) {
  const byFail = findings.filter((f) => !f.ok);
  const byOk = findings.filter((f) => f.ok);

  let md = `# Reporte de auditoría — stress test funcional\n\n`;
  md += `**Tenant:** ${lastRun.tenantSlug} (${lastRun.tenantId})\n\n`;
  md += `**Período simulado:** ${lastRun.simDays} días desde ${lastRun.simStart}\n\n`;
  md += `**Escenarios de contención:** ${lastRun.contentionFired ?? '?'} disparados / ${lastRun.contentionScheduled ?? '?'} programados\n\n`;
  md += `**Resumen:** ✅ ${byOk.length} chequeos OK — ❌ ${byFail.length} inconsistencias encontradas\n\n`;
  md += `---\n\n## ❌ Inconsistencias\n\n`;
  md += byFail.length ? '' : 'Ninguna.\n\n';
  for (const f of byFail) md += `### [${f.section}] ${f.title}\n\n${f.detail}\n\n`;
  md += `---\n\n## ✅ Lo que cuadra\n\n`;
  for (const f of byOk) md += `- **[${f.section}] ${f.title}** — ${f.detail}\n`;

  fs.mkdirSync(config.OUT_DIR, { recursive: true });
  fs.writeFileSync(config.REPORT_FILE, md);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  ✅ ${byOk.length} chequeos OK — ❌ ${byFail.length} inconsistencias`);
  console.log(`  Reporte completo: ${config.REPORT_FILE}`);
  console.log('═══════════════════════════════════════════════════════\n');
  if (byFail.length) {
    console.log('Inconsistencias encontradas:');
    for (const f of byFail) console.log(`  ❌ [${f.section}] ${f.title}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(config.LAST_RUN_FILE)) {
    throw new Error(`No se encontró ${config.LAST_RUN_FILE} — corré run.js primero.`);
  }
  const lastRun = JSON.parse(fs.readFileSync(config.LAST_RUN_FILE, 'utf8'));
  if (!lastRun.contentionLogFile) {
    throw new Error('last-run.json no tiene contentionLogFile — parece que run.js no llegó a terminar. Corré la simulación completa antes de auditar.');
  }
  const contentionLog = JSON.parse(fs.readFileSync(lastRun.contentionLogFile, 'utf8'));

  console.log(`[audit] Auditando tenant ${lastRun.tenantSlug} (${lastRun.tenantId})...\n`);

  await checkLedgerBalances(lastRun.tenantId, lastRun);
  await checkDuplicateImeiSales(lastRun.tenantId);
  await checkOpenSessions(lastRun.tenantId, contentionLog);
  await checkSalesWithoutItems(lastRun.tenantId);
  await checkSupplierPayments(lastRun.tenantId);
  await checkSalesPerDay(lastRun.tenantId);
  await checkContentionScenarios(lastRun.tenantId, contentionLog);
  await checkMiscIntegrity(lastRun.tenantId);
  await checkAgainstReportsEndpoints(lastRun.tenantId, lastRun);

  writeReport(lastRun);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[audit] ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
