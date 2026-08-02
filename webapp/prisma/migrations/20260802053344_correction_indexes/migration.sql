-- CreateIndex
CREATE INDEX "AttendanceCorrection_companyId_status_idx" ON "AttendanceCorrection"("companyId", "status");

-- CreateIndex
CREATE INDEX "AttendanceCorrection_userId_targetDate_idx" ON "AttendanceCorrection"("userId", "targetDate");
