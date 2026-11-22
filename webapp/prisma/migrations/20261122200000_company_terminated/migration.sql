-- 회사 해지(탈퇴) 표시 (2026-11-22, 이용약관 제14조 ④·제15조)
--  값이 있으면 해지된 회사 = 로그인·PC 프로그램 차단. **데이터는 지우지 않는다**(30일 유예 동안 되살리기 가능).
--  30일 뒤의 실제 파기는 2단계에서 따로 만든다. add-only라 기존 회사는 전부 null = 지금과 동일하게 동작한다.
ALTER TABLE "Company" ADD COLUMN "terminatedAt" DATETIME;
ALTER TABLE "Company" ADD COLUMN "terminatedBy" TEXT;
ALTER TABLE "Company" ADD COLUMN "terminatedNote" TEXT;
