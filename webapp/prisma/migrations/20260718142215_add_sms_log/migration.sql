-- CreateTable
CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "toNumber" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SmsLog_companyId_kind_refId_idx" ON "SmsLog"("companyId", "kind", "refId");

-- CreateIndex
CREATE INDEX "SmsLog_companyId_createdAt_idx" ON "SmsLog"("companyId", "createdAt");
