-- 결제 2단계 (2026-11-23): Company.payClaimUntil — 결제 선점(같은 회사 결제 겹침 방지). add-only(nullable).

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "payClaimUntil" DATETIME;
