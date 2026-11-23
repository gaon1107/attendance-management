-- 구독 결제(KIS) 1단계 (2026-11-23, plan-근태결제-개발.md) — 전부 add-only.
--  · Company.paidUntil: 유료 이용 만료 시각(nullable — 기존 회사 전부 null = 결제한 적 없음, 동작 그대로).
--  · PgOrder: 결제 주문서. 회사 해지 파기에서 지우지 않는다(5년 보관) — Company 외래키 없음.
--  · PgBillingKey: 자동결제 카드. 빌키(bid)는 화면·로그 금지.
--  · DEFAULT CURRENT_TIMESTAMP는 Prisma 생성 기본값 — 행은 언제나 Prisma가 시각을 넣어 만든다(직접 SQL 금지).

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "paidUntil" DATETIME;

-- CreateTable
CREATE TABLE "PgOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "orderNo" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "billingKeyId" TEXT,
    "pgMid" TEXT NOT NULL,
    "cycleKey" TEXT,
    "productName" TEXT NOT NULL,
    "employees" INTEGER NOT NULL,
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
    "pgResultCode" TEXT,
    "pgResultMsg" TEXT,
    "cardName" TEXT,
    "cardNoMasked" TEXT,
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

-- CreateTable
CREATE TABLE "PgBillingKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "regNo" TEXT NOT NULL,
    "pgMid" TEXT NOT NULL,
    "pgTid" TEXT,
    "bid" TEXT,
    "cardName" TEXT,
    "cardNoMasked" TEXT,
    "status" TEXT NOT NULL DEFAULT 'registering',
    "liveKey" TEXT,
    "nextChargeDate" DATETIME,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastResultCode" TEXT,
    "lastFailReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" DATETIME,
    "registeredAt" DATETIME,
    "pausedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PgOrder_orderNo_key" ON "PgOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "PgOrder_cycleKey_key" ON "PgOrder"("cycleKey");

-- CreateIndex
CREATE UNIQUE INDEX "PgOrder_pgTid_key" ON "PgOrder"("pgTid");

-- CreateIndex
CREATE INDEX "PgOrder_companyId_createdAt_idx" ON "PgOrder"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "PgOrder_status_lastCheckedAt_idx" ON "PgOrder"("status", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PgBillingKey_regNo_key" ON "PgBillingKey"("regNo");

-- CreateIndex
CREATE UNIQUE INDEX "PgBillingKey_pgTid_key" ON "PgBillingKey"("pgTid");

-- CreateIndex
CREATE UNIQUE INDEX "PgBillingKey_bid_key" ON "PgBillingKey"("bid");

-- CreateIndex
CREATE UNIQUE INDEX "PgBillingKey_liveKey_key" ON "PgBillingKey"("liveKey");

-- CreateIndex
CREATE INDEX "PgBillingKey_companyId_idx" ON "PgBillingKey"("companyId");

-- CreateIndex
CREATE INDEX "PgBillingKey_status_nextChargeDate_idx" ON "PgBillingKey"("status", "nextChargeDate");
