-- CompanyDocument: (companyId, kind) 를 유니크로 — 회사·종류당 1건만 허용(동시 업로드 중복 방지).
DROP INDEX IF EXISTS "CompanyDocument_companyId_kind_idx";
CREATE UNIQUE INDEX "CompanyDocument_companyId_kind_key" ON "CompanyDocument"("companyId", "kind");
