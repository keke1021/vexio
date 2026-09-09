// ─── Acceso por rol a los módulos ────────────────────────────────────────────
//
// Regla de roles de Vexio:
//   OWNER / ADMIN / SELLER → acceso TOTAL a todo el sistema (mismos módulos,
//     misma lectura y escritura, sin excepciones).
//   TECH → SOLO el módulo de Reparaciones. Nada de Inicio, Caja, Inventario,
//     Ventas, Proveedores, Transferencias ni Soporte.
//   SUPERADMIN → panel /admin (bypass acá).
//
// Capa VISUAL: el backend valida lo mismo por su cuenta (ver *.routes.js).
// Esto decide qué se muestra en el nav y a qué rutas se entra por URL directa.

export const NAV = [
  { path: '/dashboard',  label: 'Inicio',           exact: true,  module: null },
  { path: '/cash',       label: 'Caja',              exact: false, module: 'cash' },
  { path: '/inventory',  label: 'Inventario',        exact: false, module: 'inventory' },
  { path: '/pos',        label: 'Ventas',            exact: false, module: 'pos' },
  { path: '/repairs',    label: 'Reparaciones',      exact: false, module: 'repairs' },
  { path: '/suppliers',  label: 'Proveedores',       exact: false, module: 'suppliers' },
  { path: '/transfers',  label: 'Transferencias',    exact: false, module: 'multibranch' },
  { path: '/tickets',    label: 'Soporte',           exact: false, module: null },
  { path: '/settings',   label: 'Configuración',     exact: false, module: null },
];

// Tier con acceso total. Cualquier módulo (y los items sin módulo: Inicio,
// Soporte) está permitido para estos roles.
export const FULL_ACCESS_ROLES = ['OWNER', 'ADMIN', 'SELLER'];

// Qué roles pueden usar cada módulo. Todo el tier completo + TECH solo en repairs.
export const MODULE_ROLES = {
  cash:        [...FULL_ACCESS_ROLES],
  inventory:   [...FULL_ACCESS_ROLES],
  pos:         [...FULL_ACCESS_ROLES],
  repairs:     [...FULL_ACCESS_ROLES, 'TECH'],
  suppliers:   [...FULL_ACCESS_ROLES],
  multibranch: [...FULL_ACCESS_ROLES],
};

/**
 * ¿El rol puede usar este módulo (o los items sin módulo, cuando `module` es
 * null/undefined)? SUPERADMIN siempre. TECH solo 'repairs'.
 */
export const roleCanUseModule = (role, module) => {
  if (role === 'SUPERADMIN') return true;
  if (!module) return FULL_ACCESS_ROLES.includes(role);   // Inicio, Soporte, rutas base
  const allowed = MODULE_ROLES[module];
  return !allowed || allowed.includes(role);
};

/** Nav filtrado por módulos activos del plan Y por rol del usuario. */
export const filterNav = (role, activeModules = []) =>
  NAV.filter(
    (item) =>
      (item.module === null || activeModules.includes(item.module)) &&
      roleCanUseModule(role, item.module),
  );
