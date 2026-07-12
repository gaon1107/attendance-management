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
    "faceMinPercent" INTEGER NOT NULL DEFAULT 30,
    "faceMinBrightness" INTEGER NOT NULL DEFAULT 0,
    "livenessPercent" INTEGER NOT NULL DEFAULT 50,
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
INSERT INTO "new_Company" ("address", "addressDetail", "bizItem", "bizRegNo", "bizType", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinPercent", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode") SELECT "address", "addressDetail", "bizItem", "bizRegNo", "bizType", "ceoName", "companyEmail", "companyFax", "companyNote", "companyPhone", "corpRegNo", "createdAt", "faceMinPercent", "id", "lateGraceMin", "livenessPercent", "logoName", "managerEmail", "managerName", "managerPhone", "managerTitle", "name", "officeAddress", "officeAddressDetail", "officeIps", "officeLat", "officeLng", "officeRadiusM", "standardWorkHours", "website", "workDays", "workEndTime", "workStartTime", "zipCode" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
