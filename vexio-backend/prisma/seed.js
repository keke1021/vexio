// Seed de Currency — se ejecuta automáticamente después de `prisma migrate dev`
// (configurado en package.json → "prisma": { "seed": "node prisma/seed.js" }).
// Idempotente: puede correrse más de una vez sin duplicar filas.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CURRENCIES = [
  { code: 'ARS', name: 'Peso Argentino', symbol: '$', decimals: 2 },
  { code: 'USD', name: 'Dólar Estadounidense', symbol: 'US$', decimals: 2 },
  { code: 'USDT', name: 'Tether (USDT)', symbol: '₮', decimals: 2 },
];

async function main() {
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: { name: c.name, symbol: c.symbol, decimals: c.decimals },
      create: c,
    });
    console.log(`[seed] Currency ${c.code} OK`);
  }
}

main()
  .catch((err) => {
    console.error('[seed] Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
