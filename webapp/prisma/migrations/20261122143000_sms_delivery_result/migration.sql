-- 발송결과 회신 (2026-11-22, 메시지 관리 3-3)
--  비즈모아샷은 접수까지만 응답으로 알려 준다. 실제 도착 결과는 나중에 우리 서버로 되돌아온다
--  (/api/sms/callback/[token]). 그 결과를 담을 칸을 **추가만** 한다(add-only, 기존 데이터·동작 무변경).
--  🔴 기존 result 칸은 건드리지 않는다 — 발송 상한(lib/sms.ts)이 그 값을 기준으로 세기 때문이다.
ALTER TABLE "SmsLog" ADD COLUMN "indexCode" TEXT;
ALTER TABLE "SmsLog" ADD COLUMN "deliveredAt" DATETIME;
ALTER TABLE "SmsLog" ADD COLUMN "deliveryOk" BOOLEAN;
ALTER TABLE "SmsLog" ADD COLUMN "deliveryCode" TEXT;
ALTER TABLE "SmsLog" ADD COLUMN "deliveryNote" TEXT;

-- 회신은 접수번호로 기록을 찾는다. 색인이 없으면 회신 1건마다 표 전체를 훑는다.
CREATE INDEX "SmsLog_indexCode_idx" ON "SmsLog"("indexCode");
