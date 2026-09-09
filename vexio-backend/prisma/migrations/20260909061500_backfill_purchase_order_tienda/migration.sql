-- Backfill de PurchaseOrder.tiendaId para las órdenes previas al scope por
-- sucursal (Fase 2). Sin esto, las órdenes de compra existentes (incluidas
-- las PENDING) quedarían invisibles en el módulo de Proveedores, que ahora
-- filtra por sucursal activa.
--
-- Cada orden hereda la primera Tienda (por fecha de creación) de su tenant —
-- misma heurística que el backfill de RepairOrder. Las órdenes nuevas
-- completan tiendaId en el controller (createOrder, con la sucursal activa).
-- Queda NULL solo si el tenant no tiene ninguna Tienda.
UPDATE "PurchaseOrder" po
SET "tiendaId" = (
  SELECT t."id" FROM "Tienda" t
  WHERE t."tenantId" = po."tenantId"
  ORDER BY t."createdAt" ASC
  LIMIT 1
)
WHERE po."tiendaId" IS NULL;
