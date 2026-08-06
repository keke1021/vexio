-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('IMPLEMENTATION', 'MONTHLY');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paymentType" "PaymentType" NOT NULL;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "storeCount" INTEGER NOT NULL DEFAULT 1;

