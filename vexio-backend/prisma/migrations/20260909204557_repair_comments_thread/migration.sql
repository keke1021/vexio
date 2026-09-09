-- AlterTable
ALTER TABLE "RepairOrder" ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "RepairComment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "fromTech" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairComment_repairId_createdAt_idx" ON "RepairComment"("repairId", "createdAt");

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairComment" ADD CONSTRAINT "RepairComment_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairComment" ADD CONSTRAINT "RepairComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
