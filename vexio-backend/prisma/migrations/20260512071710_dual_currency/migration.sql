-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "activeModules" TEXT[] DEFAULT ARRAY[]::TEXT[];
