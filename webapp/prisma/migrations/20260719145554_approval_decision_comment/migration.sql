-- AlterTable
ALTER TABLE "AttendanceCorrection" ADD COLUMN "decidedById" TEXT;
ALTER TABLE "AttendanceCorrection" ADD COLUMN "decisionComment" TEXT;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN "decidedById" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "decisionComment" TEXT;
