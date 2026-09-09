// ─── Acceso por rol a los módulos ────────────────────────────────────────────
//
// Capa VISUAL: el backend valida lo mismo por su cuenta (ver *.routes.js:
// cash / pos / suppliers / stockTransfers). Esto solo decide qué se muestra
// en el nav y a qué rutas se puede entrar por URL directa.
//
// - `module: null`  → visible para todos los roles (Inicio, Soporte).
// - SUPERADMIN       → bypass total (igual que authorize() en el backend).
// - Si un rol no está en la lista del módulo → no ve el nav item ni entra
//   por URL (RoleRoute lo manda a /dashboard).

export const NAV = [
  { path: '/dashboard',  label: 'Inicio',           exact: true,  module: null },
  { path: '/cash',       label: 'Caja',              exact: false, module: 'cash' },
  { path: '/inventory',  label: 'Inventario',        exact: false, module: 'inventory' },
  { path: '/pos',        label: 'Ventas',            exact: false, module: 'pos' },
  { path: '/repairs',    label: 'Reparaciones',      exact: false, module: 'repairs' },
  { path: '/suppliers',  label: 'Proveedores',       exact: false, module: 'suppliers' },
  { path: '/transfers',  label: 'Transferencias',    exact: false, module: 'multibranch' },
  { path: '/tickets',    label: 'Soporte',           exact: false, module: null },
];

// Qué roles pueden usar cada módulo. OWNER y ADMIN ven todo.
export const MODULE_ROLES = {
  cash:        ['OWNER', 'ADMIN', 'SELLER'],
  inventory:   ['OWNER', 'ADMIN', 'SELLER'],
  pos:         ['OWNER', 'ADMIN', 'SELLER'],
  repairs:     ['OWNER', 'ADMIN', 'TECH'],
  suppliers:   ['OWNER', 'ADMIN'],
  // Transferencias: SELLER/TECH entran, pero el backend los limita a su
  // sucursal asignada (assertTiendaAccess) — ven/operan solo lo de su tienda,
  // y el listado completo del tenant sigue siendo OWNER/ADMIN.
  multibranch: ['OWNER', 'ADMIN', 'SELLER', 'TECH'],
};

/** ¿El rol puede usar este módulo? `module` null/desconocido → permitido. */
export const roleCanUseModule = (role, module) => {
  if (!module) return true;
  if (role === 'SUPERADMIN') return true;
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
