-- CreateTable
CREATE TABLE "WorkRecordPurgeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendanceDeleted" INTEGER NOT NULL DEFAULT 0,
    "requestDeleted" INTEGER NOT NULL DEFAULT 0,
    "shiftDeleted" INTEGER NOT NULL DEFAULT 0,
    "fileDeleted" INTEGER NOT NULL DEFAULT 0,
    "aborted" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT
);

-- CreateIndex
CREATE INDEX "WorkRecordPurgeLog_ranAt_idx" ON "WorkRecordPurgeLog"("ranAt");
