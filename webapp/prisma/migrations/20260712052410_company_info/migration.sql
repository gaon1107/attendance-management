-- AlterTable
ALTER TABLE "Company" ADD COLUMN "address" TEXT;
ALTER TABLE "Company" ADD COLUMN "addressDetail" TEXT;
ALTER TABLE "Company" ADD COLUMN "bizItem" TEXT;
ALTER TABLE "Company" ADD COLUMN "bizRegNo" TEXT;
ALTER TABLE "Company" ADD COLUMN "bizType" TEXT;
ALTER TABLE "Company" ADD COLUMN "ceoName" TEXT;
ALTER TABLE "Company" ADD COLUMN "companyEmail" TEXT;
ALTER TABLE "Company" ADD COLUMN "companyFax" TEXT;
ALTER TABLE "Company" ADD COLUMN "companyNote" TEXT;
ALTER TABLE "Company" ADD COLUMN "companyPhone" TEXT;
ALTER TABLE "Company" ADD COLUMN "corpRegNo" TEXT;
ALTER TABLE "Company" ADD COLUMN "managerEmail" TEXT;
ALTER TABLE "Company" ADD COLUMN "managerName" TEXT;
ALTER TABLE "Company" ADD COLUMN "managerPhone" TEXT;
ALTER TABLE "Company" ADD COLUMN "managerTitle" TEXT;
ALTER TABLE "Company" ADD COLUMN "website" TEXT;
ALTER TABLE "Company" ADD COLUMN "zipCode" TEXT;

-- CreateTable
CREATE TABLE "CompanyDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CompanyDocument_companyId_kind_idx" ON "CompanyDocument"("companyId", "kind");
