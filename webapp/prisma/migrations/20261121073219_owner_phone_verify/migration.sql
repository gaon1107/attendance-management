-- AlterTable
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "phoneVerifiedNumber" TEXT;

-- CreateTable
CREATE TABLE "PhoneVerifyCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME,
    "usedAt" DATETIME,
    "invalidatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneVerifyCode_slotKey_key" ON "PhoneVerifyCode"("slotKey");

-- CreateIndex
CREATE INDEX "PhoneVerifyCode_userId_createdAt_idx" ON "PhoneVerifyCode"("userId", "createdAt");
