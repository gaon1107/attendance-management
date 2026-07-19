-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApprovalStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedAt" DATETIME,
    "comment" TEXT,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ApprovalStep" ("approverUserId", "comment", "companyId", "createdAt", "decidedAt", "id", "requestId", "requestType", "status", "stepOrder") SELECT "approverUserId", "comment", "companyId", "createdAt", "decidedAt", "id", "requestId", "requestType", "status", "stepOrder" FROM "ApprovalStep";
DROP TABLE "ApprovalStep";
ALTER TABLE "new_ApprovalStep" RENAME TO "ApprovalStep";
CREATE INDEX "ApprovalStep_companyId_requestType_requestId_idx" ON "ApprovalStep"("companyId", "requestType", "requestId");
CREATE INDEX "ApprovalStep_approverUserId_status_idx" ON "ApprovalStep"("approverUserId", "status");
CREATE TABLE "new_Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "headUserId" TEXT,
    "parentId" TEXT,
    "deputyUserId" TEXT,
    "finalApproval" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Department" ("companyId", "createdAt", "deputyUserId", "headUserId", "id", "name", "parentId") SELECT "companyId", "createdAt", "deputyUserId", "headUserId", "id", "name", "parentId" FROM "Department";
DROP TABLE "Department";
ALTER TABLE "new_Department" RENAME TO "Department";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
