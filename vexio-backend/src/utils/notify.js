const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Crea notificaciones para la campanita del frontend.
 *
 *   - `userIds` vacío / omitido  → una notificación TENANT-WIDE (la ven todos
 *     los usuarios del tenant). Es el comportamiento histórico (alertas de
 *     stock bajo, etc.).
 *   - `userIds` con ids          → una fila POR usuario (notificación dirigida):
 *     transferencia pendiente de recibir, respuesta en un ticket, respuesta en
 *     el thread de una reparación. Sólo la ve ese usuario.
 *
 * Best-effort: nunca lanza. Un fallo al notificar no debe voltear la operación
 * de negocio que la disparó (despacho, reply, etc.).
 *
 * @param {object}   opts
 * @param {string}   opts.tenantId
 * @param {string[]} [opts.userIds]
 * @param {string}   opts.message
 * @param {'INFO'|'WARNING'|'DANGER'} [opts.type='INFO']
 * @param {string|null} [opts.link]  ruta del frontend (ej. "/transfers/abc")
 */
const notify = async ({ tenantId, userIds = [], message, type = 'INFO', link = null }) => {
  try {
    if (!message) return;

    const uniq = [...new Set((userIds || []).filter(Boolean))];

    if (uniq.length === 0) {
      await prisma.notification.create({ data: { tenantId, message, type, link } });
      return;
    }

    await prisma.notification.createMany({
      data: uniq.map((userId) => ({ tenantId, userId, message, type, link })),
    });
  } catch (err) {
    console.error('[notify]', err);
  }
};

module.exports = { notify };
