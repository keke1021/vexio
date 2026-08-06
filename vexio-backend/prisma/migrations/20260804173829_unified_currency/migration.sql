-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('SALE', 'CASH_MOVEMENT_INCOME', 'CASH_MOVEMENT_EXPENSE', 'SESSION_OPEN', 'SESSION_CLOSE_ADJUSTMENT', 'PURCHASE_ORDER', 'SUBSCRIPTION_PAYMENT', 'CONVERSION');

-- AlterTable
ALTER TABLE "CashMovement" DROP COLUMN "currency",
ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'ARS',
ADD COLUMN     "referenceRateId" TEXT,
ALTER COLUMN "exchangeRate" SET DATA TYPE DECIMAL(18,6);

-- AlterTable
ALTER TABLE "CashSession" DROP COLUMN "finalAmount",
DROP COLUMN "initialAmountARS",
DROP COLUMN "initialAmountUSD";

-- AlterTable
ALTER TABLE "InventoryItem" DROP COLUMN "currency",
ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "currency",
ADD COLUMN     "currencyCode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PurchaseOrder" DROP COLUMN "currency",
ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "currencyCode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Sale" DROP COLUMN "currency",
DROP COLUMN "exchangeType",
ADD COLUMN     "currencyCode" TEXT NOT NULL DEFAULT 'ARS',
ADD COLUMN     "referenceRateId" TEXT,
ALTER COLUMN "exchangeRate" SET DATA TYPE DECIMAL(18,6);

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "originalCostPrice" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "originalCurrencyCode" TEXT NOT NULL,
ADD COLUMN     "originalSalePrice" DECIMAL(10,2) NOT NULL;

-- DropEnum
DROP TYPE "ExchangeType";

-- DropEnum
DROP TYPE "PaymentCurrency";

-- DropEnum
DROP TYPE "SaleCurrency";

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrencyCode" TEXT NOT NULL,
    "toCurrencyCode" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "validDate" DATE NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "appliedRate" DECIMAL(18,6),
    "appliedRateBase" TEXT,
    "cashSessionId" TEXT,
    "saleId" TEXT,
    "cashMovementId" TEXT,
    "purchaseOrderId" TEXT,
    "paymentId" TEXT,
    "conversionId" TEXT,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromCurrencyCode" TEXT NOT NULL,
    "toCurrencyCode" TEXT NOT NULL,
    "fromAmount" DECIMAL(10,2) NOT NULL,
    "toAmount" DECIMAL(10,2) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "cashSessionId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_validDate_idx" ON "ExchangeRate"("validDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_fromCurrencyCode_toCurrencyCode_validDate_key" ON "ExchangeRate"("fromCurrencyCode", "toCurrencyCode", "validDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_currencyCode_idx" ON "LedgerEntry"("tenantId", "currencyCode");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_cashSessionId_idx" ON "LedgerEntry"("tenantId", "cashSessionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_type_idx" ON "LedgerEntry"("tenantId", "type");

-- CreateIndex
CREATE INDEX "Conversion_tenantId_idx" ON "Conversion"("tenantId");

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_fromCurrencyCode_fkey" FOREIGN KEY ("fromCurrencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_toCurrencyCode_fkey" FOREIGN KEY ("toCurrencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_fromCurrencyCode_fkey" FOREIGN KEY ("fromCurrencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_toCurrencyCode_fkey" FOREIGN KEY ("toCurrencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_referenceRateId_fkey" FOREIGN KEY ("referenceRateId") REFERENCES "ExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_originalCurrencyCode_fkey" FOREIGN KEY ("originalCurrencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_referenceRateId_fkey" FOREIGN KEY ("referenceRateId") REFERENCES "ExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

