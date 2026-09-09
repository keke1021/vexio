/**
 * assertTiendaAccess(user, tiendaId)
 *
 * Autorización POR USUARIO sobre una sucursal puntual — distinto de
 * findTenantTienda (utils/tienda.js), que solo valida "¿esta sucursal
 * pertenece a este tenant?". Esta función responde: "¿ESTE usuario puede
 * operar ESTA sucursal en particular?".
 *
 * Se usa solo en el módulo StockTransfer. Desde que la regla de roles pasó a
 * "OWNER/ADMIN/SELLER = acceso total, TECH = solo Reparaciones", TODOS los
 * roles que llegan a esos endpoints (OWNER/ADMIN/SELLER/SUPERADMIN — TECH está
 * bloqueado a nivel de ruta) son unrestricted, así que en la práctica esto
 * siempre devuelve true. Se mantiene por si a futuro se reintroduce un rol
 * scopeado por sucursal.
 */
const UNRESTRICTED_ROLES = ['OWNER', 'ADMIN', 'SELLER', 'SUPERADMIN'];

const assertTiendaAccess = (user, tiendaId) => {
  if (UNRESTRICTED_ROLES.includes(user.role)) return true;
  return !!tiendaId && user.tiendaId === tiendaId;
};

module.exports = { assertTiendaAccess };
