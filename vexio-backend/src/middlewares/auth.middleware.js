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

module.exports = { authenticate, authorize };
