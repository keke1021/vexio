// Corrección de timestamps post-ráfaga (Opción A aprobada).
//
// Ningún endpoint de escritura acepta un createdAt custom — así que la
// concurrencia real ocurre contra los controllers en tiempo real (ráfagas de
// unos pocos minutos por "día simulado"), y ESTE módulo corrige después,
// vía Prisma directo, la fecha de cada fila creada al momento planeado
// dentro del día simulado correspondiente. No es un cambio de producción:
// es exactamente el mismo patrón que ya usa seed-demo.js para poblar
// createdAt a mano.
//
// day-simulator.js arma la lista de `events` (uno por cada request que
// devolvió un id utilizable) DURANTE la ejecución del día, y llama a
// applyEvents() una sola vez al cerrar ese día.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const handlers = {
  SALE: async ({ id, plannedTime }) => {
    await Promise.all([
      prisma.sale.update({ where: { id }, data: { createdAt: plannedTime } }),
      prisma.saleItem.updateMany({ where: { saleId: id }, data: { createdAt: plannedTime } }),
      prisma.cashMovement.updateMany({ where: { saleId: id }, data: { createdAt: plannedTime } }),
      prisma.ledgerEntry.updateMany({ where: { saleId: id }, data: { createdAt: plannedTime } }),
    ]);
  },

  CASH_SESSION_OPEN: async ({ id, plannedTime }) => {
    await Promise.all([
      prisma.cashSession.update({ where: { id }, data: { openedAt: plannedTime } }),
      prisma.ledgerEntry.updateMany({ where: { cashSessionId: id, type: 'SESSION_OPEN' }, data: { createdAt: plannedTime } }),
    ]);
  },

  CASH_SESSION_CLOSE: async ({ id, plannedTime }) => {
    await Promise.all([
      prisma.cashSession.update({ where: { id }, data: { closedAt: plannedTime } }),
      prisma.ledgerEntry.updateMany({ where: { cashSessionId: id, type: 'SESSION_CLOSE_ADJUSTMENT' }, data: { createdAt: plannedTime } }),
    ]);
  },

  CASH_MOVEMENT: async ({ id, plannedTime }) => {
    await Promise.all([
      prisma.cashMovement.update({ where: { id }, data: { createdAt: plannedTime } }),
      prisma.ledgerEntry.updateMany({ where: { cashMovementId: id }, data: { createdAt: plannedTime } }),
    ]);
  },

  REPAIR_CREATE: async ({ id, plannedTime }) => {
    await Promise.all([
      prisma.repairOrder.update({ where: { id }, data: { createdAt: plannedTime } }),
      prisma.repairStatusHistory.updateMany({ where: { repairId: id, status: 'RECEIVED' }, data: { createdAt: plannedTime } }),
    ]);
  },

  REPAIR_UPDATE: async ({ id, plannedTime, newStatus }) => {
    const lastHistory = await prisma.repairStatusHistory.findFirst({
      where: { repairId: id }, orderBy: { createdAt: 'desc' },
    });
    const ops = [];
    if (lastHistory) {
      ops.push(prisma.repairStatusHistory.update({ where: { id: lastHistory.id }, data: { createdAt: plannedTime } }));
    }
    const extra = {};
    if (newStatus === 'READY') extra.readyAt = plannedTime;
    if (newStatus === 'DELIVERED') extra.deliveredAt = plannedTime;
    ops.push(prisma.repairOrder.update({ where: { id }, data: extra }));
    await Promise.all(ops);
  },

  PURCHASE_ORDER_CREATE: async ({ id, plannedTime, downPaymentId }) => {
    await Promise.all([
      prisma.purchaseOrder.update({ where: { id }, data: { createdAt: plannedTime } }),
      prisma.purchaseOrderItem.updateMany({ where: { orderId: id }, data: { createdAt: plannedTime } }),
    ]);
    if (downPaymentId) {
      await handlers.SUPPLIER_PAYMENT({ id: downPaymentId, plannedTime });
    }
  },

  PURCHASE_ORDER_RECEIVE: async ({ id, plannedTime }) => {
    await Promise.all([
      prisma.purchaseOrder.update({ where: { id }, data: { receivedAt: plannedTime } }),
      prisma.ledgerEntry.updateMany({ where: { purchaseOrderId: id, type: 'PURCHASE_ORDER' }, data: { createdAt: plannedTime } }),
    ]);
  },

  SUPPLIER_PAYMENT: async ({ id, plannedTime }) => {
    const payment = await prisma.supplierPayment.findUnique({ where: { id } });
    if (!payment) return;
    const ops = [
      prisma.supplierPayment.update({ where: { id }, data: { paidAt: plannedTime, createdAt: plannedTime } }),
    ];
    if (payment.cashMovementId) {
      ops.push(prisma.cashMovement.update({ where: { id: payment.cashMovementId }, data: { createdAt: plannedTime } }));
      ops.push(prisma.ledgerEntry.updateMany({ where: { cashMovementId: payment.cashMovementId }, data: { createdAt: plannedTime } }));
    } else {
      ops.push(prisma.ledgerEntry.updateMany({ where: { supplierPaymentId: id }, data: { createdAt: plannedTime } }));
    }
    await Promise.all(ops);
  },

  SUPPLIER_CREATE: async ({ id, plannedTime }) => {
    await prisma.supplier.update({ where: { id }, data: { createdAt: plannedTime } });
  },

  INVENTORY_RESTOCK: async ({ tenantId, tiendaId, imeiPrefix, plannedTime }) => {
    await prisma.inventoryItem.updateMany({
      where: { tenantId, tiendaId, imei: { startsWith: imeiPrefix } },
      data: { createdAt: plannedTime },
    });
  },
};

/**
 * Aplica una lista de eventos { kind, plannedTime, ...datos por kind }.
 * Se corren en paralelo entre sí (son filas distintas, sin dependencias
 * cruzadas salvo el caso downPaymentId, manejado adentro del handler).
 * Devuelve { applied, failed: [{event, error}] } — un fallo acá es un bug
 * del script (id inexistente, etc.), no un resultado esperado del test, así
 * que se reporta pero no aborta el resto.
 */
async function applyEvents(events) {
  const results = await Promise.allSettled(
    events.map((ev) => {
      const handler = handlers[ev.kind];
      if (!handler) return Promise.reject(new Error(`kind desconocido: ${ev.kind}`));
      return handler(ev);
    })
  );

  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') failed.push({ event: events[i], error: r.reason?.message || String(r.reason) });
  });
  if (failed.length) {
    console.warn(`[timeshift] ${failed.length} evento(s) fallaron al corregir fecha:`, failed);
  }
  return { applied: events.length - failed.length, failed };
}

module.exports = { applyEvents, disconnect: () => prisma.$disconnect() };
