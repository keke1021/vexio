const jwt = require('jsonwebtoken');

/**
 * authenticate
 * Valida el Bearer token del header Authorization.
 * Si es válido, agrega `req.user` con { userId, tenantId, role }.
 */
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Token no proporcionado.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded; // { userId, tenantId, role, iat, exp }
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expirado.' });
    }
    return res.status(401).json({ message: 'Token inválido.' });
  }
};

/**
 * authorize(...roles)
 * Factory de middleware que restringe el acceso a los roles especificados.
 *
 * Uso: router.get('/ruta', authenticate, authorize('OWNER', 'ADMIN'), handler)
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'No autenticado.' });
    }
    // SUPERADMIN bypasses all role checks
    if (req.user.role === 'SUPERADMIN' || roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ message: 'Permisos insuficientes.' });
  };
};

/**
 * requireActiveTienda
 * Corta con 409 cualquier request de negocio si la sesión no tiene una
 * sucursal activa elegida (claim `tiendaId` del JWT). Pasa solo con
 * OWNER/ADMIN multi-sucursal que todavía no seleccionó — el frontend lo
 * interpreta como "mostrá el selector de sucursal". SUPERADMIN pasa siempre
 * (no está sujeto al scope por sucursal; tampoco usa estas rutas en la
 * práctica).
 *
 * Se monta POR-RUTA en los routers de features (nunca como router.use(...) —
 * todos cuelgan del prefijo compartido '/api', así que un router.use correría
 * para requests de otros módulos que apenas atraviesan este router).
 */
const requireActiveTienda = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'No autenticado.' });
  }
  // SUPERADMIN no está sujeto al scope por sucursal. TECH tampoco para su
  // único módulo (Reparaciones): ve las órdenes de TODAS las sucursales
  // combinadas — excepción explícita. El resto de los routers de negocio ya
  // rechazan a TECH con authorize(...) antes de llegar acá, así que esta
  // excepción solo aplica en repairs.
  if (req.user.role === 'SUPERADMIN' || req.user.role === 'TECH') return next();
  if (!req.user.tiendaId) {
    return res.status(409).json({ message: 'Elegí una sucursal para operar.', code: 'NO_ACTIVE_TIENDA' });
  }
  next();
};

module.exports = { authenticate, authorize, requireActiveTienda };
