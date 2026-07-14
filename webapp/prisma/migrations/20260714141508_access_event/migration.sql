-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT,
    "userId" TEXT,
    "actorName" TEXT,
    "emailTried" TEXT,
    "kind" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "device" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AccessEvent_companyId_createdAt_idx" ON "AccessEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessEvent_kind_idx" ON "AccessEvent"("kind");
