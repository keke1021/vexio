const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * GET /api/notifications
 * Devuelve notificaciones no leídas del usuario actual.
 * SUPERADMIN → tenantId null | tenant user → tenantId del tenant.
 */
const getNotifications = async (req, res) => {
  try {
    const { tenantId, role, userId } = req.user;
    // Un usuario del tenant ve: las tenant-wide (userId null) + las dirigidas a
    // él. SUPERADMIN sólo ve las suyas (tenantId null; nunca dirigidas).
    const where = role === 'SUPERADMIN'
      ? { tenantId: null, read: false }
      : { tenantId, read: false, OR: [{ userId: null }, { userId }] };

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    res.json({ notifications, count: notifications.length });
  } catch (error) {
    console.error('[notifications:get]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/notifications/:id/read
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, role, userId } = req.user;

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) return res.status(404).json({ message: 'Notificación no encontrada.' });

    // Verificar pertenencia: mismo tenant y, si es dirigida, que sea al usuario.
    const isOwner = role === 'SUPERADMIN'
      ? notification.tenantId === null
      : notification.tenantId === tenantId
        && (notification.userId === null || notification.userId === userId);

    if (!isOwner) return res.status(403).json({ message: 'Sin permiso.' });

    await prisma.notification.update({ where: { id }, data: { read: true } });
    res.json({ ok: true });
  } catch (error) {
    console.error('[notifications:markRead]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

/**
 * PUT /api/notifications/read-all
 */
const markAllAsRead = async (req, res) => {
  try {
    const { tenantId, role, userId } = req.user;
    const where = role === 'SUPERADMIN'
      ? { tenantId: null }
      : { tenantId, OR: [{ userId: null }, { userId }] };

    await prisma.notification.updateMany({ where, data: { read: true } });
    res.json({ message: 'Todas las notificaciones marcadas como leídas.' });
  } catch (error) {
    console.error('[notifications:markAllRead]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead };
