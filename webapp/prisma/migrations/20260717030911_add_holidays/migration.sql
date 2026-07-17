-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CompanyHoliday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyHoliday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
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
    "logoName" TEXT
);
INSERT INTO "new_Company" ("address", "addressDetail", "alertFailCount", "alertFailOn", "alertNightEnd", "alertNightOn", "alertNightStart", "bizItem", "bizRegNo", "bizType", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinBrightness", "faceMinPercent", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "securityCheckedAt", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode") SELECT "address", "addressDetail", "alertFailCount", "alertFailOn", "alertNightEnd", "alertNightOn", "alertNightStart", "bizItem", "bizRegNo", "bizType", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinBrightness", "faceMinPercent", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "securityCheckedAt", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Holiday_year_idx" ON "Holiday"("year");

-- CreateIndex
CREATE INDEX "CompanyHoliday_companyId_idx" ON "CompanyHoliday"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHoliday_companyId_date_key" ON "CompanyHoliday"("companyId", "date");
