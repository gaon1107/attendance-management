-- 회사 계정 발송 표시 (2026-11-21, 메시지 관리 2단계 — plan-회사별문자-메시지관리.md).
--  · 칸만 더한다(표 재생성 없음). Prisma가 자동으로 만든 안은 SmsLog 표를 새로 만들어 복사하는 방식이라
--    운영 데이터 이동을 피하려고 손으로 바꿨다. 결과 구조는 같다(prisma migrate가 어긋남 없음으로 확인).
ALTER TABLE "SmsLog" ADD COLUMN "viaCompany" BOOLEAN NOT NULL DEFAULT false;

-- 1단계의 시험 문자(sms_test)는 전부 회사 계정으로 나간 것이다 → 가온 전체 상한에서 빠지게 표시.
UPDATE "SmsLog" SET "viaCompany" = true WHERE "kind" = 'sms_test';
