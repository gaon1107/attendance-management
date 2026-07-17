-- AlterTable
ALTER TABLE "CompanyEvent" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "CompanyEvent_userId_idx" ON "CompanyEvent"("userId");
