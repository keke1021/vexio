// Orquestador de la Fase 1 — bootstrap + los N días simulados, uno detrás
// del otro (cada día en sí es una ráfaga de requests concurrentes real; los
// días se suceden secuencialmente porque el roster/reposición/contención de
// un día depende del estado que dejó el anterior).
//
// Uso: node scripts/stress-test/run.js   (desde vexio-backend/, con el
// backend corriendo en otra terminal — npm run dev)

const fs = require('fs');
const config = require('./config');
const bootstrap = require('./bootstrap');
const { simulateDay } = require('./day-simulator');
const timeshift = require('./timeshift');

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Stress test funcional — ${config.SIM_DAYS} días simulados`);
  console.log(`  Backend: ${config.BASE_URL}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const boot = await bootstrap.run();
  console.log(`\n[run] Tenant listo: ${boot.tenantId} (${boot.tenantSlug})`);
  console.log(`[run] Guardado en ${config.LAST_RUN_FILE} — audit.js y finalize.js lo leen de ahí.\n`);

  const ctx = {
    tenantId: boot.tenantId,
    tiendas: boot.tiendas,
    employees: boot.employees,
    owner: boot.owner,
    suppliers: boot.suppliers,
    sessions: boot.sessions,
    repairsPool: [],
    purchaseOrders: [],
  };

  const allContention = [];
  const salesByDay = [];

  for (let dayIndex = 0; dayIndex < config.SIM_DAYS; dayIndex++) {
    const { contentionLog, salesPlanned } = await simulateDay({ dayIndex, ctx });
    allContention.push(...contentionLog);
    salesByDay.push({ dayIndex, salesPlanned });
  }

  const path = require('path');
  const contentionLogFile = path.join(config.OUT_DIR, `contention-log-${config.RUN_TAG}.json`);
  fs.writeFileSync(contentionLogFile, JSON.stringify(allContention, null, 2));

  // Se completa last-run.json (bootstrap.js ya lo había creado con los datos
  // del tenant) con lo que solo se conoce al terminar la simulación —
  // audit.js necesita esto para saber qué log leer y qué esperar.
  const lastRun = JSON.parse(fs.readFileSync(config.LAST_RUN_FILE, 'utf8'));
  lastRun.runTag = config.RUN_TAG;
  lastRun.runLogFile = config.RUN_LOG_FILE;
  lastRun.contentionLogFile = contentionLogFile;
  lastRun.salesByDay = salesByDay;
  lastRun.contentionScheduled = config.CONTENTION_SCHEDULE.length;
  lastRun.contentionFired = allContention.length;
  fs.writeFileSync(config.LAST_RUN_FILE, JSON.stringify(lastRun, null, 2));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Simulación terminada');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Tenant:              ${boot.tenantSlug} (${boot.tenantId})`);
  console.log(`  Días simulados:      ${config.SIM_DAYS}`);
  console.log(`  Ventas planeadas:    ${salesByDay.reduce((s, d) => s + d.salesPlanned, 0)} (por día: ${salesByDay.map((d) => d.salesPlanned).join(', ')})`);
  console.log(`  Escenarios de contención disparados: ${allContention.length} / ${config.CONTENTION_SCHEDULE.length} programados`);
  console.log(`  Log de requests:     ${config.RUN_LOG_FILE}`);
  console.log(`  Log de contención:   out/contention-log-${config.RUN_TAG}.json`);
  console.log('───────────────────────────────────────────────────────');
  console.log('  Siguiente paso: npm run stress:audit   (Fase 2 — auditoría)');
  console.log('  Al terminar de auditar: npm run stress:finalize   (marca el tenant SUSPENDED)');
  console.log('═══════════════════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[run] ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    // bootstrap.js y timeshift.js abren cada uno su propio PrismaClient —
    // ambos mantienen una connection pool viva que si no, deja el proceso
    // colgado sin salir solo. process.exit() de arriba corta todo igual,
    // esto es solo para no dejar warnings si algún día se saca el exit.
    await timeshift.disconnect().catch(() => {});
  });
