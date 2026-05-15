-- AlterTable
ALTER TABLE "CashSession" DROP COLUMN "initialAmount",
ADD COLUMN     "initialAmountARS" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "initialAmountUSD" DECIMAL(10,2) NOT NULL DEFAULT 0;
