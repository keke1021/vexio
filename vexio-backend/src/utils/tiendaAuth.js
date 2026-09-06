/**
 * assertTiendaAccess(user, tiendaId)
 *
 * Autorización POR USUARIO sobre una sucursal puntual — distinto de
 * findTenantTienda (utils/tienda.js), que solo valida "¿esta sucursal
 * pertenece a este tenant?". Esta función responde una pregunta distinta:
 * "¿ESTE usuario puede operar ESTA sucursal en particular?".
 *
 * Hoy es EXCLUSIVA del módulo StockTransfer — POS/Caja/Compras siguen sin
 * restringir por la tienda propia del usuario (ver comentario junto a
 * User.tiendaId en schema.prisma). Se implementa acá, separada de
 * findTenantTienda, para no tocar el comportamiento de ningún otro módulo.
 *
 * OWNER/ADMIN/SUPERADMIN: sin restricción (mismo bypass que ya usa
 * authorize() en auth.middleware.js).
 * SELLER/TECH: solo pueden operar la sucursal que tienen asignada
 * (User.tiendaId). Un usuario sin tiendaId asignada (tiendaId=null) queda
 * bloqueado de TODA sucursal — fail closed, no fail open — porque no hay
 * forma de saber a cuál sucursal pertenece.
 */
const UNRESTRICTED_ROLES = ['OWNER', 'ADMIN', 'SUPERADMIN'];

const assertTiendaAccess = (user, tiendaId) => {
  if (UNRESTRICTED_ROLES.includes(user.role)) return true;
  return !!tiendaId && user.tiendaId === tiendaId;
};

module.exports = { assertTiendaAccess };
