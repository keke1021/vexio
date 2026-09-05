// Paso final, manual y explícito — marca el tenant de stress test como
// SUSPENDED (nunca se borra, mismo criterio que "Demo UX Caja"/"Demo Empty
// POS": queda en la DB para poder auditarlo a mano en Prisma Studio después).
//
// Deliberadamente NO se llama automáticamente desde run.js ni audit.js — se
// corre a mano cuando ya se revisó el reporte de auditoría y no hace falta
// seguir operando el tenant.
//
// Uso: node scripts/stress-test/finalize.js

const fs = require('fs');
const config = require('./config');
const { Session } = require('./lib/api-client');

async function main() {
  if (!fs.existsSync(config.LAST_RUN_FILE)) {
    throw new Error(`No se encontró ${config.LAST_RUN_FILE} — corré run.js primero.`);
  }
  const lastRun = JSON.parse(fs.readFileSync(config.LAST_RUN_FILE, 'utf8'));

  const sa = new Session('SUPERADMIN');
  await sa.login(config.SUPERADMIN.email, config.SUPERADMIN.password);

  const r = await sa.put(`/admin/tenants/${lastRun.tenantId}`, { status: 'SUSPENDED' }, { phase: 'finalize' });
  if (!r.ok) throw new Error(`No se pudo suspender el tenant: ${JSON.stringify(r.body)}`);

  console.log(`[finalize] Tenant ${lastRun.tenantSlug} (${lastRun.tenantId}) marcado SUSPENDED. No se borró ningún dato.`);
}

main()
  .catch((err) => {
    console.error('[finalize] ERROR:', err);
    process.exitCode = 1;
  });
