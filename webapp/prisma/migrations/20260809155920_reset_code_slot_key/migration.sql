/*
  Warnings:

  - Added the required column `slotKey` to the `PasswordResetCode` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PasswordResetCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "usedAt" DATETIME,
    "invalidatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- ⚠️ slotKey는 NOT NULL + UNIQUE인데 기본값이 없다. Prisma가 만들어 준 원본은 이 칸을 빼고 복사해서,
--    표에 행이 한 줄이라도 있으면 "NOT NULL constraint failed"로 마이그레이션이 통째로 멈춘다
--    (파일 첫 줄 경고가 바로 그 뜻이다). 비개발자가 복구하기 어려운 실패라 미리 막는다.
--    → 기존 행에는 유일값인 "id"를 그대로 채운다. 옛 행은 이미 발송이 끝난 것이라 발송 슬롯으로서의
--      의미가 없고, 유일하기만 하면 UNIQUE 제약을 만족한다.
INSERT INTO "new_PasswordResetCode" ("attemptCount", "codeHash", "companyId", "createdAt", "expiresAt", "id", "invalidatedAt", "slotKey", "usedAt", "userId") SELECT "attemptCount", "codeHash", "companyId", "createdAt", "expiresAt", "id", "invalidatedAt", "id", "usedAt", "userId" FROM "PasswordResetCode";
DROP TABLE "PasswordResetCode";
ALTER TABLE "new_PasswordResetCode" RENAME TO "PasswordResetCode";
CREATE UNIQUE INDEX "PasswordResetCode_slotKey_key" ON "PasswordResetCode"("slotKey");
CREATE INDEX "PasswordResetCode_userId_createdAt_idx" ON "PasswordResetCode"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
