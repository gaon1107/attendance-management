-- AlterTable
ALTER TABLE "Company" ADD COLUMN "scheduleType" TEXT;
ALTER TABLE "Company" ADD COLUMN "shiftMode" INTEGER;

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    CONSTRAINT "Shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShiftPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "shiftId" TEXT,
    CONSTRAINT "ShiftPattern_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShiftGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT
);

-- CreateTable
CREATE TABLE "RotationRule" (
    "companyId" TEXT NOT NULL PRIMARY KEY,
    "orderCsv" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "anchorDate" TEXT NOT NULL,
    CONSTRAINT "RotationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shiftId" TEXT,
    "editedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ShiftChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "fromLabel" TEXT,
    "toLabel" TEXT,
    "actor" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "employeeNo" TEXT,
    "hireDate" DATETIME,
    "noticesSeenAt" DATETIME,
    "tourSeenAt" DATETIME,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "phone", "position", "role", "tourSeenAt", "workDays") SELECT "annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "phone", "position", "role", "tourSeenAt", "workDays" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Shift_companyId_order_key" ON "Shift"("companyId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPattern_userId_dayOfWeek_key" ON "ShiftPattern"("userId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftGroup_companyId_order_key" ON "ShiftGroup"("companyId", "order");

-- CreateIndex
CREATE INDEX "ShiftAssignment_companyId_date_idx" ON "ShiftAssignment"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAssignment_userId_date_key" ON "ShiftAssignment"("userId", "date");

-- CreateIndex
CREATE INDEX "ShiftChangeLog_companyId_createdAt_idx" ON "ShiftChangeLog"("companyId", "createdAt");
