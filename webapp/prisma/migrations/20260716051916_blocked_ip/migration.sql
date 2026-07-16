-- CreateTable
CREATE TABLE "BlockedIp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "BlockedIp_companyId_idx" ON "BlockedIp"("companyId");
