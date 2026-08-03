-- CreateIndex
CREATE INDEX "Announcement_companyId_createdAt_idx" ON "Announcement"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ClockPhoto_fileDeletedAt_createdAt_idx" ON "ClockPhoto"("fileDeletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_companyId_status_idx" ON "PasswordResetRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_userId_status_idx" ON "PasswordResetRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "ShiftPattern_companyId_idx" ON "ShiftPattern"("companyId");
