-- CreateTable
CREATE TABLE "ClockPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendanceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "livenessStatus" TEXT NOT NULL,
    "livenessScore" REAL,
    "fileName" TEXT NOT NULL,
    "fileDeletedAt" DATETIME,
    "lastViewedBy" TEXT,
    "lastViewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClockPhoto_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ClockPhoto_companyId_createdAt_idx" ON "ClockPhoto"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ClockPhoto_attendanceId_idx" ON "ClockPhoto"("attendanceId");
