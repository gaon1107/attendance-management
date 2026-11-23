-- AlterTable
ALTER TABLE "PgBillingKey" ADD COLUMN "refundMarkedAt" DATETIME;
ALTER TABLE "PgBillingKey" ADD COLUMN "refundMarkedBy" TEXT;

-- AlterTable
ALTER TABLE "PgOrder" ADD COLUMN "operatorCancelAt" DATETIME;
ALTER TABLE "PgOrder" ADD COLUMN "operatorCancelBy" TEXT;
ALTER TABLE "PgOrder" ADD COLUMN "periodRevertedAt" DATETIME;
