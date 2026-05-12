/**
 * fix-modules.js
 * One-time script: assign activeModules to every tenant based on their current plan.
 * Run once: node fix-modules.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PLAN_MODULES = {
  STARTER: ['inventory', 'pos', 'customers'],
  PRO:     ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties'],
  FULL:    ['inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers', 'warranties', 'whatsapp', 'reports', 'multibranch'],
};

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, plan: true, activeModules: true } });
  console.log(`Found ${tenants.length} tenants.`);

  for (const t of tenants) {
    const modules = PLAN_MODULES[t.plan] ?? PLAN_MODULES.STARTER;
    await prisma.tenant.update({ where: { id: t.id }, data: { activeModules: modules } });
    console.log(`✓ ${t.name} (${t.plan}) → [${modules.join(', ')}]`);
  }

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
