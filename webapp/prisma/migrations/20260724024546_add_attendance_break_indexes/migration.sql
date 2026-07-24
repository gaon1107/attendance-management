-- CreateIndex
CREATE INDEX "Attendance_companyId_clockIn_idx" ON "Attendance"("companyId", "clockIn");

-- CreateIndex
CREATE INDEX "Attendance_userId_clockIn_idx" ON "Attendance"("userId", "clockIn");

-- CreateIndex
CREATE INDEX "Break_attendanceId_idx" ON "Break"("attendanceId");
