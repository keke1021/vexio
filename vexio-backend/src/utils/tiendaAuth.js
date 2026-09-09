/**
 * Autorización / scope POR SUCURSAL.
 *
 * La "sucursal activa" de la sesión viaja como claim `tiendaId` en el JWT
 * (la elige el usuario en el login / en POST /auth/select-tienda; ver
 * auth.controller.js). El backend valida SIEMPRE contra ese claim e ignora
 * cualquier tiendaId que venga en query/body de un request.
 *
 *   - getActiveTiendaId(req): devuelve la sucursal activa del JWT. Tira 409 si
 *     no hay ninguna elegida — pasa solo con OWNER/ADMIN multi-sucursal que
 *     todavía no seleccionó; el frontend lo interpreta como "mostrá el
 *     selector de sucursal". Para rutas montadas con requireActiveTienda
 *     (auth.middleware) esto ya está garantizado y nunca tira.
 *
 *   - assertTiendaAccess(user, tiendaId): "¿ESTE usuario puede operar ESTA
 *     sucursal puntual?". Se usa donde un recurso tiene una sucursal propia
 *     que hay que contrastar contra la activa (ej. StockTransfer.fromTiendaId /
 *     toTiendaId). Solo SUPERADMIN queda fuera del scope por sucursal — para
 *     el resto (OWNER/ADMIN/SELLER/TECH) el acceso es exactamente su sucursal
 *     activa. OWNER/ADMIN no ven una vista combinada: para tocar otra sucursal
 *     cambian la activa (select-tienda) y recargan.
 */

// Roles que NO están sujetos al scope por sucursal.
const UNRESTRICTED_ROLES = ['SUPERADMIN'];

const assertTiendaAccess = (user, tiendaId) => {
  if (UNRESTRICTED_ROLES.includes(user.role)) return true;
  return !!tiendaId && user.tiendaId === tiendaId;
};

class NoActiveTiendaError extends Error {
  constructor() {
    super('NO_ACTIVE_TIENDA');
    this.status = 409;
  }
}

const getActiveTiendaId = (req) => {
  const id = req.user?.tiendaId;
  if (!id) throw new NoActiveTiendaError();
  return id;
};

module.exports = { assertTiendaAccess, getActiveTiendaId, NoActiveTiendaError, UNRESTRICTED_ROLES };
