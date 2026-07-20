-- CreateTable
CREATE TABLE "JobGrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobGrade_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "jobGradeId" TEXT,
    "employeeNo" TEXT,
    "hireDate" DATETIME,
    "noticesSeenAt" DATETIME,
    "tourSeenAt" DATETIME,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_jobGradeId_fkey" FOREIGN KEY ("jobGradeId") REFERENCES "JobGrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "phone", "position", "role", "shiftGroupId", "tourSeenAt", "workDays") SELECT "annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "phone", "position", "role", "shiftGroupId", "tourSeenAt", "workDays" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "JobGrade_companyId_idx" ON "JobGrade"("companyId");
