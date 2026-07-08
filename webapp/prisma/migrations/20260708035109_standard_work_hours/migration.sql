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
    "officeIps" TEXT,
    "workStartTime" TEXT,
    "workEndTime" TEXT,
    "lateGraceMin" INTEGER NOT NULL DEFAULT 0,
    "standardWorkHours" REAL NOT NULL DEFAULT 8,
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5'
);
INSERT INTO "new_Company" ("createdAt", "id", "lateGraceMin", "name", "officeIps", "officeLat", "officeLng", "officeRadiusM", "workDays", "workEndTime", "workStartTime") SELECT "createdAt", "id", "lateGraceMin", "name", "officeIps", "officeLat", "officeLng", "officeRadiusM", "workDays", "workEndTime", "workStartTime" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
