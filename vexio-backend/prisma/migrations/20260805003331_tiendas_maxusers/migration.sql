-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "maxUsers" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tiendaId" TEXT;

-- CreateTable
CREATE TABLE "Tienda" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tienda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tienda_tenantId_idx" ON "Tienda"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tienda_name_tenantId_key" ON "Tienda"("name", "tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tiendaId_fkey" FOREIGN KEY ("tiendaId") REFERENCES "Tienda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tienda" ADD CONSTRAINT "Tienda_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
