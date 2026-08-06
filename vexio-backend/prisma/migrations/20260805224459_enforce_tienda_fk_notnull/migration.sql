/*
  Warnings:

  - Made the column `tiendaId` on table `CashSession` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tiendaId` on table `InventoryItem` required. This step will fail if there are existing NULL values in that column.
  - Made the column `tiendaId` on table `Sale` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "CashSession" DROP CONSTRAINT "CashSession_tiendaId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_tiendaId_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_tiendaId_fkey";

-- AlterTable
ALTER TABLE "CashSession" ALTER COLUMN "tiendaId" SET NOT NULL;

-- AlterTable
ALTER TABLE "InventoryItem" ALTER COLUMN "tiendaId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Sale" ALTER COLUMN "tiendaId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
