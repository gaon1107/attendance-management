-- 회사 해지 2단계 — 해지 30일 뒤 자동 파기 (2026-11-22, lib/company-purge.ts)
--  · Company.purgeStartedAt: 파기가 시작되면 찍힌다 → 되살리기 거부. add-only(nullable) — 기존 회사 전부 null = 동작 그대로.
--  · CompanyPurgeLog: 파기 대장(건수만, 이름 없음). Company와 외래키 없음(회사 행이 지워진 뒤에도 남는다).
--  · ranAt DEFAULT CURRENT_TIMESTAMP는 Prisma 생성 기본값이다 — 행은 항상 Prisma가 시각을 넣어 만든다(직접 SQL로 넣지 말 것).

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "purgeStartedAt" DATETIME;

-- CreateTable
CREATE TABLE "CompanyPurgeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "terminatedAt" DATETIME NOT NULL,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "faceDeleted" INTEGER NOT NULL DEFAULT 0,
    "fileDeleted" INTEGER NOT NULL DEFAULT 0,
    "attendanceDeleted" INTEGER NOT NULL DEFAULT 0,
    "requestDeleted" INTEGER NOT NULL DEFAULT 0,
    "shiftDeleted" INTEGER NOT NULL DEFAULT 0,
    "agentDeleted" INTEGER NOT NULL DEFAULT 0,
    "userDeleted" INTEGER NOT NULL DEFAULT 0,
    "otherDeleted" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT
);

-- CreateIndex
CREATE INDEX "CompanyPurgeLog_companyId_ranAt_idx" ON "CompanyPurgeLog"("companyId", "ranAt");

-- CreateIndex
CREATE INDEX "CompanyPurgeLog_ranAt_idx" ON "CompanyPurgeLog"("ranAt");
