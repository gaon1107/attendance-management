-- CreateTable
CREATE TABLE "AgentDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "agentVersion" TEXT,
    "pairedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "AgentDevice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentPairCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentPairCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AgentDevice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "officeLat" REAL,
    "officeLng" REAL,
    "officeRadiusM" INTEGER NOT NULL DEFAULT 200,
    "officeAddress" TEXT,
    "officeAddressDetail" TEXT,
    "officeIps" TEXT,
    "workStartTime" TEXT,
    "workEndTime" TEXT,
    "lateGraceMin" INTEGER NOT NULL DEFAULT 0,
    "standardWorkHours" REAL NOT NULL DEFAULT 8,
    "overtimeAlertOn" BOOLEAN NOT NULL DEFAULT true,
    "overtimeWarnHours" REAL NOT NULL DEFAULT 48,
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "outingReasons" TEXT,
    "breakCheckOn" BOOLEAN NOT NULL DEFAULT true,
    "breakMin4h" INTEGER NOT NULL DEFAULT 30,
    "breakMin8h" INTEGER NOT NULL DEFAULT 60,
    "holidayAutoOn" BOOLEAN NOT NULL DEFAULT true,
    "faceMinPercent" INTEGER NOT NULL DEFAULT 30,
    "faceMinBrightness" INTEGER NOT NULL DEFAULT 0,
    "livenessPercent" INTEGER NOT NULL DEFAULT 50,
    "securityCheckedAt" DATETIME,
    "alertNightOn" BOOLEAN NOT NULL DEFAULT true,
    "alertNightStart" INTEGER NOT NULL DEFAULT 22,
    "alertNightEnd" INTEGER NOT NULL DEFAULT 6,
    "alertFailOn" BOOLEAN NOT NULL DEFAULT true,
    "alertFailCount" INTEGER NOT NULL DEFAULT 5,
    "bizRegNo" TEXT,
    "corpRegNo" TEXT,
    "ceoName" TEXT,
    "bizType" TEXT,
    "bizItem" TEXT,
    "zipCode" TEXT,
    "address" TEXT,
    "addressDetail" TEXT,
    "companyPhone" TEXT,
    "companyFax" TEXT,
    "companyEmail" TEXT,
    "website" TEXT,
    "managerName" TEXT,
    "managerTitle" TEXT,
    "managerPhone" TEXT,
    "managerEmail" TEXT,
    "companyNote" TEXT,
    "logoName" TEXT,
    "shiftMode" INTEGER,
    "scheduleType" TEXT,
    "approvalMode" TEXT NOT NULL DEFAULT 'single',
    "approvalStepCount" INTEGER NOT NULL DEFAULT 1,
    "pcOffOn" BOOLEAN NOT NULL DEFAULT false,
    "pcOffMode" TEXT NOT NULL DEFAULT 'lock',
    "pcOffDelayMin" INTEGER NOT NULL DEFAULT 30,
    "pcOffNotifyMins" TEXT NOT NULL DEFAULT '10,5',
    "pcOffTempUseMin" INTEGER NOT NULL DEFAULT 30,
    "pcOffTempUsePerDay" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "new_Company" ("address", "addressDetail", "alertFailCount", "alertFailOn", "alertNightEnd", "alertNightOn", "alertNightStart", "approvalMode", "approvalStepCount", "bizItem", "bizRegNo", "bizType", "breakCheckOn", "breakMin4h", "breakMin8h", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinBrightness", "faceMinPercent", "holidayAutoOn", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "outingReasons", "overtimeAlertOn", "overtimeWarnHours", "scheduleType", "securityCheckedAt", "shiftMode", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode") SELECT "address", "addressDetail", "alertFailCount", "alertFailOn", "alertNightEnd", "alertNightOn", "alertNightStart", "approvalMode", "approvalStepCount", "bizItem", "bizRegNo", "bizType", "breakCheckOn", "breakMin4h", "breakMin8h", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinBrightness", "faceMinPercent", "holidayAutoOn", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "outingReasons", "overtimeAlertOn", "overtimeWarnHours", "scheduleType", "securityCheckedAt", "shiftMode", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authMethod" TEXT,
    "faceConsentAt" DATETIME,
    "faceEnrolledAt" DATETIME,
    "faceEnrollCount" INTEGER NOT NULL DEFAULT 0,
    "workDays" TEXT,
    "shiftGroupId" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "deactivatedAt" DATETIME,
    "annualLeaveDays" REAL NOT NULL DEFAULT 15,
    "annualLeaveOverride" REAL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "departmentId" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "jobGradeId" TEXT,
    "employeeNo" TEXT,
    "hireDate" DATETIME,
    "noticesSeenAt" DATETIME,
    "tourSeenAt" DATETIME,
    "pcOffExempt" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_jobGradeId_fkey" FOREIGN KEY ("jobGradeId") REFERENCES "JobGrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "jobGradeId", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "phone", "position", "role", "shiftGroupId", "tourSeenAt", "workDays") SELECT "annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "jobGradeId", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "phone", "position", "role", "shiftGroupId", "tourSeenAt", "workDays" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_companyId_idx" ON "User"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AgentDevice_tokenHash_key" ON "AgentDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentDevice_companyId_idx" ON "AgentDevice"("companyId");

-- CreateIndex
CREATE INDEX "AgentDevice_userId_idx" ON "AgentDevice"("userId");

-- CreateIndex
CREATE INDEX "AgentPairCode_userId_idx" ON "AgentPairCode"("userId");

-- CreateIndex
CREATE INDEX "AgentPairCode_code_idx" ON "AgentPairCode"("code");

-- CreateIndex
CREATE INDEX "AgentEvent_companyId_at_idx" ON "AgentEvent"("companyId", "at");

-- CreateIndex
CREATE INDEX "AgentEvent_userId_at_idx" ON "AgentEvent"("userId", "at");

-- CreateIndex
CREATE INDEX "AgentEvent_deviceId_idx" ON "AgentEvent"("deviceId");
