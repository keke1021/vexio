-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ItemStatus" ADD VALUE 'IN_TRANSIT';

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "tiendaId" TEXT;

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "currentTransferId" TEXT,
ADD COLUMN     "tiendaId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "tiendaId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "tiendaId" TEXT;

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "tenantId" TEXT NOT NULL,
    "fromTiendaId" TEXT NOT NULL,
    "toTiendaId" TEXT NOT NULL,
    "dispatchedById" TEXT NOT NULL,
    "receivedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockTransfer_tenantId_idx" ON "StockTransfer"("tenantId");

-- CreateIndex
CREATE INDEX "StockTransfer_fromTiendaId_idx" ON "StockTransfer"("fromTiendaId");

-- CreateIndex
CREATE INDEX "StockTransfer_toTiendaId_idx" ON "StockTransfer"("toTiendaId");

-- CreateIndex
CREATE INDEX "CashSession_tenantId_tiendaId_idx" ON "CashSession"("tenantId", "tiendaId");

-- CreateIndex
CREATE INDEX "InventoryItem_tenantId_tiendaId_idx" ON "InventoryItem"("tenantId", "tiendaId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_tiendaId_idx" ON "PurchaseOrder"("tenantId", "tiendaId");

-- CreateIndex
CREATE INDEX "Sale_tenantId_tiendaId_idx" ON "Sale"("tenantId", "tiendaId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_currentTransferId_fkey" FOREIGN KEY ("currentTransferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromTiendaId_fkey" FOREIGN KEY ("fromTiendaId") REFERENCES "Tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toTiendaId_fkey" FOREIGN KEY ("toTiendaId") REFERENCES "Tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
