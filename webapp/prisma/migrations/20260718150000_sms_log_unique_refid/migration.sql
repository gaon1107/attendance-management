-- 1회 제한을 DB에서 원자적으로 보장: (companyId, kind, refId) 유니크로 이중발송 차단.
-- 기존 비유니크 인덱스를 유니크로 교체. SmsLog는 비어 있어 중복 없음.

-- DropIndex
DROP INDEX "SmsLog_companyId_kind_refId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "SmsLog_companyId_kind_refId_key" ON "SmsLog"("companyId", "kind", "refId");
