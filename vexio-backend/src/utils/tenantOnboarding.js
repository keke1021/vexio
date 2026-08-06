const bcrypt = require('bcryptjs');

// Mismos módulos que Tenant.plan=FULL (default del schema) — todo tenant
// nuevo entra con acceso completo por default. Ídem al PLAN_MODULES.FULL
// que ya vive (duplicado) en auth.controller.js y admin.controller.js —
// no se tocan esos dos por las dudas de que algo más los use, pero el alta
// de tenant en sí ahora pasa por acá, una sola vez.
const FULL_MODULES = [
  'inventory', 'pos', 'customers', 'repairs', 'cash', 'suppliers',
  'warranties', 'whatsapp', 'reports', 'multibranch',
];

/**
 * Crea un Tenant + su primer User (role OWNER) en una única transacción.
 * Mismo criterio de alta para los dos flujos que existen hoy:
 *   - POST /api/auth/register (público, se loguea solo)
 *   - POST /api/admin/tenants (SUPERADMIN, alta manual desde /admin)
 * No se duplica la lógica de hasheo de password ni la forma de crear el
 * Tenant/User entre ambos controllers — los dos llaman a esto.
 *
 * `extraTenantData` permite pisar/agregar campos del Tenant que el alta
 * pública no expone (ej. maxUsers, solo seteable por Admin).
 */
const createTenantWithOwner = async (prisma, { tenantName, tenantSlug, email, password, name, extraTenantData = {} }) => {
  const hashedPassword = await bcrypt.hash(password, 12);

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: tenantName,
        slug: tenantSlug,
        email,
        activeModules: FULL_MODULES,
        ...extraTenantData,
      },
    });

    const user = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'OWNER',
        tenantId: tenant.id,
      },
    });

    return { tenant, user };
  });
};

module.exports = { createTenantWithOwner, FULL_MODULES };
