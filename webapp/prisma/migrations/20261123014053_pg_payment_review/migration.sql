-- 결제 1단계 검수 반영 (2026-11-23) — 앞 마이그레이션(pg_payment)과 함께 처음 운영에 나간다(그 전에는 표가 비어 있다).
--  · PgOrder: firstLiveKey(첫 결제 중복 방지)·billingCycleDate(회차 날짜)·headEmployees/headAdmins(인원 내역)·buyerName/buyerBizRegNo(5년 보관용 구매자 복사본)·pgPayMethod·cardType
--  · PgBillingKey: cardType. liveKey 뜻은 주석만 바뀜(active·paused일 때만 값).

-- AlterTable
ALTER TABLE "PgBillingKey" ADD COLUMN "cardType" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PgOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "orderNo" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "billingKeyId" TEXT,
    "pgMid" TEXT NOT NULL,
    "cycleKey" TEXT,
    "firstLiveKey" TEXT,
    "billingCycleDate" DATETIME,
    "productName" TEXT NOT NULL,
    "employees" INTEGER NOT NULL,
    "headEmployees" INTEGER NOT NULL DEFAULT 0,
    "headAdmins" INTEGER NOT NULL DEFAULT 0,
    "buyerName" TEXT,
    "buyerBizRegNo" TEXT,
    "tierIndex" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL DEFAULT 1,
    "payMethod" TEXT NOT NULL DEFAULT 'CARD',
    "supplyAmount" INTEGER NOT NULL,
    "vatAmount" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "pgTid" TEXT,
    "pgAmount" INTEGER,
    "pgAppNo" TEXT,
    "pgPayMethod" TEXT,
    "pgResultCode" TEXT,
    "pgResultMsg" TEXT,
    "cardName" TEXT,
    "cardNoMasked" TEXT,
    "cardType" TEXT,
    "paidAt" DATETIME,
    "cancelledAt" DATETIME,
    "prevPaidUntil" DATETIME,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" DATETIME,
    "failReason" TEXT,
    "followedUpAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_PgOrder" ("billingKeyId", "cancelledAt", "cardName", "cardNoMasked", "companyId", "createdAt", "cycleKey", "employees", "failReason", "followedUpAt", "id", "lastCheckedAt", "orderNo", "orderType", "paidAt", "payMethod", "periodEnd", "periodStart", "pgAmount", "pgAppNo", "pgMid", "pgResultCode", "pgResultMsg", "pgTid", "prevPaidUntil", "productName", "retryCount", "status", "supplyAmount", "termMonths", "tierIndex", "totalAmount", "updatedAt", "userId", "vatAmount") SELECT "billingKeyId", "cancelledAt", "cardName", "cardNoMasked", "companyId", "createdAt", "cycleKey", "employees", "failReason", "followedUpAt", "id", "lastCheckedAt", "orderNo", "orderType", "paidAt", "payMethod", "periodEnd", "periodStart", "pgAmount", "pgAppNo", "pgMid", "pgResultCode", "pgResultMsg", "pgTid", "prevPaidUntil", "productName", "retryCount", "status", "supplyAmount", "termMonths", "tierIndex", "totalAmount", "updatedAt", "userId", "vatAmount" FROM "PgOrder";
DROP TABLE "PgOrder";
ALTER TABLE "new_PgOrder" RENAME TO "PgOrder";
CREATE UNIQUE INDEX "PgOrder_orderNo_key" ON "PgOrder"("orderNo");
CREATE UNIQUE INDEX "PgOrder_cycleKey_key" ON "PgOrder"("cycleKey");
CREATE UNIQUE INDEX "PgOrder_firstLiveKey_key" ON "PgOrder"("firstLiveKey");
CREATE UNIQUE INDEX "PgOrder_pgTid_key" ON "PgOrder"("pgTid");
CREATE INDEX "PgOrder_companyId_createdAt_idx" ON "PgOrder"("companyId", "createdAt");
CREATE INDEX "PgOrder_status_lastCheckedAt_idx" ON "PgOrder"("status", "lastCheckedAt");
CREATE INDEX "PgOrder_billingKeyId_billingCycleDate_idx" ON "PgOrder"("billingKeyId", "billingCycleDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
