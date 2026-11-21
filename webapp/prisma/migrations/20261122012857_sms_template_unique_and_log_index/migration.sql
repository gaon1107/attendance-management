-- 보관기간(1년) 자동 파기 전용 색인 (2026-11-22 검수 중간 4)
--  파기 조건이 `createdAt < 기준일` 하나뿐이라 기존 색인([companyId, createdAt])을 쓸 수 없어 표 전체를 훑었다.
--  AccessEvent가 같은 이유로 createdAt 단독 색인을 둔다 — 같은 처방이다. 기존 데이터는 그대로다(add-only).
CREATE INDEX "SmsLog_createdAt_idx" ON "SmsLog"("createdAt");

-- 같은 회사 안에서 템플릿 이름 중복 금지 (2026-11-22 검수 중간 5)
--  액션의 "읽어 보고 → 만든다" 검사만으로는 두 관리자가 같은 순간 저장할 때 2개가 생긴다.
--  ⚠️ 적용 시점에 이미 중복 이름이 있으면 실패한다 — SmsTemplate은 2026-11-22에 만든 표라 운영에도 0건이다.
CREATE UNIQUE INDEX "SmsTemplate_companyId_name_key" ON "SmsTemplate"("companyId", "name");
