-- 결제 2단계 검수 반영 (2026-11-23): PgOrder.approveRequestedAt — 결제 없음 유예를 승인 요청 시각부터 센다. add-only.

-- AlterTable
ALTER TABLE "PgOrder" ADD COLUMN "approveRequestedAt" DATETIME;
