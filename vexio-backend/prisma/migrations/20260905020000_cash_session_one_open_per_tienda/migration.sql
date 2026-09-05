-- Garantiza a nivel de base de datos que no puede existir más de una
-- CashSession abierta (closedAt IS NULL) por tienda al mismo tiempo.
--
-- El chequeo que ya hacía cash.controller.js (findFirst({tenantId, tiendaId,
-- closedAt: null}) antes de crear) es "check-then-act": bajo concurrencia
-- real, dos requests de apertura para la misma tienda pueden pasar ese
-- chequeo antes de que cualquiera de las dos haya insertado su fila —
-- confirmado con el stress test funcional (escenario DOUBLE_OPEN_CASH,
-- 2/2 reproducciones). Un chequeo en código nunca cierra esa ventana por sí
-- solo; hace falta un constraint real de DB.
--
-- Índice único PARCIAL (WHERE "closedAt" IS NULL) — no puede expresarse en
-- schema.prisma (Prisma no tiene sintaxis para filtered/partial indexes a
-- esta versión), así que vive únicamente acá. Ver comentario junto al
-- modelo CashSession en schema.prisma.
CREATE UNIQUE INDEX "CashSession_tiendaId_open_unique"
ON "CashSession" ("tiendaId")
WHERE "closedAt" IS NULL;
