/*
  Warnings:

  - You are about to drop the column `receivedAt` on the `StockTransfer` table. All the data in the column will be lost.
  - You are about to drop the column `receivedById` on the `StockTransfer` table. All the data in the column will be lost.
  - The `status` column on the `StockTransfer` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `createdById` to the `StockTransfer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `StockTransfer` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('OPEN', 'DISPATCHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "StockTransferItemStatus" AS ENUM ('PREPARING', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "StockTransfer" DROP CONSTRAINT "StockTransfer_dispatchedById_fkey";

-- DropForeignKey
ALTER TABLE "StockTransfer" DROP CONSTRAINT "StockTransfer_receivedById_fkey";

-- DropIndex
DROP INDEX "StockTransfer_fromTiendaId_idx";

-- DropIndex
DROP INDEX "StockTransfer_tenantId_idx";

-- DropIndex
DROP INDEX "StockTransfer_toTiendaId_idx";

-- AlterTable
ALTER TABLE "StockTransfer" DROP COLUMN "receivedAt",
DROP COLUMN "receivedById",
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "deliveryId" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "StockTransferStatus" NOT NULL DEFAULT 'OPEN',
ALTER COLUMN "dispatchedById" DROP NOT NULL;

-- DropEnum
DROP TYPE "TransferStatus";

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "status" "StockTransferItemStatus" NOT NULL DEFAULT 'PREPARING',
    "transferId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Delivery_tenantId_idx" ON "Delivery"("tenantId");

-- CreateIndex
CREATE INDEX "StockTransferItem_transferId_idx" ON "StockTransferItem"("transferId");

-- CreateIndex
CREATE INDEX "StockTransferItem_inventoryItemId_idx" ON "StockTransferItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockTransfer_tenantId_fromTiendaId_status_idx" ON "StockTransfer"("tenantId", "fromTiendaId", "status");

-- CreateIndex
CREATE INDEX "StockTransfer_tenantId_toTiendaId_status_idx" ON "StockTransfer"("tenantId", "toTiendaId", "status");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Garantiza a nivel de DB que no puede existir más de un lote OPEN por
-- combinación (tenantId, fromTiendaId, toTiendaId) al mismo tiempo — mismo
-- criterio que CashSession_tiendaId_open_unique (ver migración
-- 20260905020000_cash_session_one_open_per_tienda): el findFirst optimista
-- del controller no cierra la ventana de carrera bajo dos altas concurrentes
-- para la misma combinación origen→destino, hace falta un constraint real.
-- Índice único PARCIAL (WHERE status='OPEN') — no representable en
-- schema.prisma, ver comentario junto al modelo StockTransfer.
CREATE UNIQUE INDEX "StockTransfer_open_lane_unique"
ON "StockTransfer" ("tenantId", "fromTiendaId", "toTiendaId")
WHERE "status" = 'OPEN';

-- Garantiza a nivel de DB que un mismo InventoryItem no puede tener más de
-- una membresía "viva" (PREPARING o DISPATCHED) en StockTransferItem al
-- mismo tiempo — la garantía real de "un IMEI no puede estar en dos lotes a
-- la vez ni sumarse dos veces al mismo", independiente de si
-- InventoryItem.status está sincronizado correctamente o no. Defensa en
-- profundidad además del updateMany condicionado por status que ya usa el
-- controller (mismo patrón que pos.controller.js/createSale).
-- Índice único PARCIAL — no representable en schema.prisma.
CREATE UNIQUE INDEX "StockTransferItem_live_membership_unique"
ON "StockTransferItem" ("inventoryItemId")
WHERE "status" IN ('PREPARING', 'DISPATCHED');
