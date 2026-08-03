-- 9-B 일회성 데이터 정리 (2026-08-03) — 스키마 변경 없음, UPDATE만.
--  · 배경: 퇴사 처리(H-6, 2026-08-02)가 "그 이후 퇴사자"의 부서장/대결자 칸 해제와 pending 결재 건너뜀을
--    처리하지만, H-6 **이전에** 퇴사한 사람의 잔존 데이터는 그대로였다: 퇴사자를 가리키는
--    Department.headUserId/deputyUserId, 퇴사자 앞에서 영영 멈춘 ApprovalStep(pending).
--  · 결재선 런타임(9-A)은 퇴사자를 걸러 새 신청은 안전하지만, 이미 만들어진 pending 단계는
--    관리자 오버라이드 없이는 풀리지 않으므로 여기서 한 번에 건너뜀 처리한다.
--  · 날짜 저장 형식 주의: 이 DB의 DATETIME은 정수(epoch 밀리초)다. CURRENT_TIMESTAMP(문자열)를 쓰면
--    Prisma가 못 읽는다 → strftime 초 단위 × 1000. (DB 사본에서 7개 단언 PASS 확인, 2026-08-03)
--  · 멱등: 조건에 걸리는 행이 없으면 무변화. 재직자 데이터는 건드리지 않는다.

UPDATE "Department" SET "headUserId" = NULL
WHERE "headUserId" IN (SELECT "id" FROM "User" WHERE "deactivatedAt" IS NOT NULL);

UPDATE "Department" SET "deputyUserId" = NULL
WHERE "deputyUserId" IN (SELECT "id" FROM "User" WHERE "deactivatedAt" IS NOT NULL);

UPDATE "ApprovalStep"
SET "status" = 'skipped',
    "decidedAt" = CAST(strftime('%s','now') AS INTEGER) * 1000,
    "comment" = '결재자 퇴사로 자동 건너뜀(기존 데이터 일괄 정리)'
WHERE "status" = 'pending'
  AND "approverUserId" IN (SELECT "id" FROM "User" WHERE "deactivatedAt" IS NOT NULL);
