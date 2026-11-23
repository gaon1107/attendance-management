-- AlterTable
ALTER TABLE "Company" ADD COLUMN "approvedTierIndex" INTEGER;

-- AlterTable
ALTER TABLE "PgBillingKey" ADD COLUMN "consentTierIndex" INTEGER;
ALTER TABLE "PgBillingKey" ADD COLUMN "consentTotal" INTEGER;
ALTER TABLE "PgBillingKey" ADD COLUMN "consentedAt" DATETIME;
