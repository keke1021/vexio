/**
 * Busca una Tienda por id exigiendo que pertenezca al tenant dado — mismo
 * criterio de validación que ya usaba inventory.controller.js (create,
 * bulkUpload) de forma inline. Se extrae acá porque cash.controller.js lo
 * necesita en varios endpoints (open, close, addMovement, getMovements,
 * getSummary, getCurrent) y no tiene sentido repetir la query 6 veces.
 * Devuelve la Tienda o null — el caller decide el mensaje/status del 400.
 */
const findTenantTienda = (prisma, tenantId, tiendaId) =>
  prisma.tienda.findFirst({ where: { id: tiendaId, tenantId } });

module.exports = { findTenantTienda };
