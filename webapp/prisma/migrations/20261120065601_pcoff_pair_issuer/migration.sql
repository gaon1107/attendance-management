-- AlterTable
ALTER TABLE "AgentDevice" ADD COLUMN "pairedByAdminId" TEXT;
ALTER TABLE "AgentDevice" ADD COLUMN "pairedByAdminName" TEXT;

-- AlterTable
ALTER TABLE "AgentPairCode" ADD COLUMN "issuedById" TEXT;
ALTER TABLE "AgentPairCode" ADD COLUMN "issuedByName" TEXT;
