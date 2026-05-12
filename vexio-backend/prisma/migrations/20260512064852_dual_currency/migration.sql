-- CreateEnum
CREATE TYPE "SaleCurrency" AS ENUM ('ARS', 'USD', 'USDT');

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "currency" "SaleCurrency" NOT NULL DEFAULT 'ARS',
ADD COLUMN     "exchangeRate" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "currency" "SaleCurrency" NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "currency" "SaleCurrency" NOT NULL DEFAULT 'ARS';
