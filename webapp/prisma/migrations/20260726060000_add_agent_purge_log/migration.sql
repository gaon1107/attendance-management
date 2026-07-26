-- CreateTable
CREATE TABLE "AgentPurgeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workDeleted" INTEGER NOT NULL DEFAULT 0,
    "systemDeleted" INTEGER NOT NULL DEFAULT 0,
    "resignedDeleted" INTEGER NOT NULL DEFAULT 0,
    "aborted" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT
);

-- CreateIndex
CREATE INDEX "AgentPurgeLog_ranAt_idx" ON "AgentPurgeLog"("ranAt");

-- CreateIndex
CREATE INDEX "AgentEvent_type_at_idx" ON "AgentEvent"("type", "at");

