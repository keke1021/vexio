const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  tienda: { select: { id: true, name: true } },
};

/**
 * GET /api/users
 * Listado de SOLO LECTURA de los empleados del tenant (Configuración → Usuarios).
 * Disponible para OWNER/ADMIN/SELLER (TECH queda afuera a nivel ruta).
 * No incluye SUPERADMIN. El alta/baja de usuarios sigue siendo manual desde el
 * panel SUPERADMIN — acá no hay create/delete, sólo la reasignación de sucursal
 * (y esa, sólo para el OWNER).
 */
const listUsers = async (req, res) => {
  try {
    const { tenantId } = req.user;
    const users = await prisma.user.findMany({
      where: { tenantId, role: { not: 'SUPERADMIN' } },
      select: USER_SELECT,
      orderBy: [{ name: 'asc' }],
    });
    res.json({ users });
  } catch (error) {
    console.error('[users:listUsers]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/users/:id/tienda
 * Body: { tiendaId: string | null }
 * Reasigna la sucursal de un empleado ya existente. SOLO OWNER — el gate está a
 * nivel ruta con authorize('OWNER') (ni siquiera SELLER, que por lo demás tiene
 * los mismos permisos que el OWNER).
 *
 * Al reasignar se ELIMINAN todos los refresh tokens del empleado: su sesión
 * activa queda invalidada de inmediato. Cuando su access token venza (≤15 min)
 * el /auth/refresh falla y vuelve al login — no sigue operando scopeado a la
 * sucursal vieja hasta su próximo login voluntario.
 */
const reassignTienda = async (req, res) => {
  try {
    const { tenantId, userId } = req.user;
    const { id } = req.params;
    const { tiendaId } = req.body;

    if (id === userId) {
      return res.status(400).json({ message: 'No podés reasignar tu propia sucursal desde acá.' });
    }

    const target = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!target) return res.status(404).json({ message: 'Usuario no encontrado.' });
    if (target.role === 'SUPERADMIN') {
      return res.status(403).json({ message: 'No se puede modificar a un superadmin.' });
    }

    if (tiendaId) {
      const tienda = await prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });
      if (!tienda) {
        return res.status(400).json({ message: 'La sucursal no existe o no pertenece a tu cuenta.' });
      }
    }

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { tiendaId: tiendaId ?? null },
        select: USER_SELECT,
      }),
      // Invalidación inmediata de la sesión: sin refresh tokens el empleado no
      // puede renovar su access token y cae al login.
      prisma.refreshToken.deleteMany({ where: { userId: id } }),
    ]);

    res.json({ user: updated });
  } catch (error) {
    console.error('[users:reassignTienda]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { listUsers, reassignTienda };
