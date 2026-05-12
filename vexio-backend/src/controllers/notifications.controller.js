const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * GET /api/notifications
 * Devuelve notificaciones no leídas del usuario actual.
 * SUPERADMIN → tenantId null | tenant user → tenantId del tenant.
 */
const getNotifications = async (req, res) => {
  try {
    const { tenantId, role } = req.user;
    const where = role === 'SUPERADMIN'
      ? { tenantId: null, read: false }
      : { tenantId, read: false };

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
    const { tenantId, role } = req.user;

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) return res.status(404).json({ message: 'Notificación no encontrada.' });

    // Verificar pertenencia
    const isOwner = role === 'SUPERADMIN'
      ? notification.tenantId === null
      : notification.tenantId === tenantId;

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
    const { tenantId, role } = req.user;
    const where = role === 'SUPERADMIN' ? { tenantId: null } : { tenantId };

    await prisma.notification.updateMany({ where, data: { read: true } });
    res.json({ message: 'Todas las notificaciones marcadas como leídas.' });
  } catch (error) {
    console.error('[notifications:markAllRead]', error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead };
