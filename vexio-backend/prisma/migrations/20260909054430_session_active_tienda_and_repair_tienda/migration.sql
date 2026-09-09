-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "activeTiendaId" TEXT;

-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "tiendaId" TEXT;

-- CreateIndex
CREATE INDEX "RepairOrder_tenantId_tiendaId_idx" ON "RepairOrder"("tenantId", "tiendaId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_activeTiendaId_fkey" FOREIGN KEY ("activeTiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada RepairOrder previa hereda la primera Tienda (por fecha de
-- creación) de su tenant. Las órdenes nuevas completan tiendaId en el
-- controller (createRepair). Queda NULL solo si el tenant no tiene ninguna
-- Tienda (no debería pasar tras el onboarding con "Principal").
UPDATE "RepairOrder" ro
SET "tiendaId" = (
  SELECT t."id" FROM "Tienda" t
  WHERE t."tenantId" = ro."tenantId"
  ORDER BY t."createdAt" ASC
  LIMIT 1
)
WHERE ro."tiendaId" IS NULL;
