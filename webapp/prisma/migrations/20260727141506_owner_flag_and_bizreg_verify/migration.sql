-- AlterTable
ALTER TABLE "Company" ADD COLUMN "bizRegNoVerifiedAt" DATETIME;

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
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_User" ("annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "jobGradeId", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "pcOffExempt", "phone", "position", "role", "shiftGroupId", "tourSeenAt", "workDays") SELECT "annualLeaveDays", "annualLeaveOverride", "authMethod", "companyId", "createdAt", "deactivatedAt", "departmentId", "email", "employeeNo", "faceConsentAt", "faceEnrollCount", "faceEnrolledAt", "failedLoginCount", "hireDate", "id", "jobGradeId", "lockedUntil", "mustChangePassword", "name", "noticesSeenAt", "passwordHash", "pcOffExempt", "phone", "position", "role", "shiftGroupId", "tourSeenAt", "workDays" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_companyId_idx" ON "User"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
