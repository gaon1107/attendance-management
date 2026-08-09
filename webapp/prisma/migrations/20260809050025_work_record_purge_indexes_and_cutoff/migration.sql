-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkRecordPurgeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cutoffAt" DATETIME,
    "attendanceDeleted" INTEGER NOT NULL DEFAULT 0,
    "requestDeleted" INTEGER NOT NULL DEFAULT 0,
    "shiftDeleted" INTEGER NOT NULL DEFAULT 0,
    "fileDeleted" INTEGER NOT NULL DEFAULT 0,
    "aborted" BOOLEAN NOT NULL DEFAULT false,
    "more" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT
);
INSERT INTO "new_WorkRecordPurgeLog" ("aborted", "attendanceDeleted", "fileDeleted", "id", "note", "ranAt", "requestDeleted", "shiftDeleted") SELECT "aborted", "attendanceDeleted", "fileDeleted", "id", "note", "ranAt", "requestDeleted", "shiftDeleted" FROM "WorkRecordPurgeLog";
DROP TABLE "WorkRecordPurgeLog";
ALTER TABLE "new_WorkRecordPurgeLog" RENAME TO "WorkRecordPurgeLog";
CREATE INDEX "WorkRecordPurgeLog_ranAt_idx" ON "WorkRecordPurgeLog"("ranAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ApprovalStep_requestType_requestId_idx" ON "ApprovalStep"("requestType", "requestId");

-- CreateIndex
CREATE INDEX "Attendance_clockIn_idx" ON "Attendance"("clockIn");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_targetDate_idx" ON "AttendanceCorrection"("targetDate");

-- CreateIndex
CREATE INDEX "BusinessTripRequest_endDate_idx" ON "BusinessTripRequest"("endDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_endDate_idx" ON "LeaveRequest"("endDate");

-- CreateIndex
CREATE INDEX "OutingRequest_targetDate_idx" ON "OutingRequest"("targetDate");

-- CreateIndex
CREATE INDEX "OvertimeRequest_targetDate_idx" ON "OvertimeRequest"("targetDate");

-- CreateIndex
CREATE INDEX "RemoteWorkRequest_endDate_idx" ON "RemoteWorkRequest"("endDate");

-- CreateIndex
CREATE INDEX "RequestAttachment_requestType_requestId_idx" ON "RequestAttachment"("requestType", "requestId");

-- CreateIndex
CREATE INDEX "ShiftAssignment_date_idx" ON "ShiftAssignment"("date");

-- CreateIndex
CREATE INDEX "ShiftChangeLog_date_idx" ON "ShiftChangeLog"("date");
