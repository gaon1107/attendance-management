-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "cancelledAt" DATETIME;
ALTER TABLE "LeaveRequest" ADD COLUMN "cancelledById" TEXT;
