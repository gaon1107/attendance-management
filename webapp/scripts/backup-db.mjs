// [운영 DB 백업 — 상자 안에서 실행] (2026-11-18, 운영 준비 2-3)
//
// 사용(서버의 deploy/server/backup-attendance.sh가 부른다):
//   docker exec attendance-app node scripts/backup-db.mjs /data/db/.backup-YYYYMMDD-HHMMSS.db
//
// 하는 일: 켜져 있는 DB를 멈추지 않고 한 시점의 완전한 사본으로 복사(SQLite `VACUUM INTO`) → 사본 무결성 검사.
//   · 파일을 그냥 cp 하면 쓰는 도중의 반쪽 파일이 복사될 수 있다. VACUUM INTO는 DB 엔진이 일관된 사본을 만든다.
//   · 검사(PRAGMA integrity_check)가 "ok"가 아니면 사본을 지우고 실패(종료코드 1)로 끝낸다 → 깨진 백업을 남기지 않는다.
// 안전장치: 결과 경로는 /data/db/ 안의 ".backup-"로 시작하는 .db 파일만 허용(실제 DB 파일을 덮어쓰지 않게).
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const out = process.argv[2] || "";
const name = path.basename(out);
if (!path.isAbsolute(out) || path.dirname(out) !== "/data/db" || !/^\.backup-[0-9-]+\.db$/.test(name)) {
  console.error(`[backup-db] ❌ 결과 경로가 올바르지 않습니다(/data/db/.backup-<시각>.db 만 허용): ${out}`);
  process.exit(1);
}
if (fs.existsSync(out)) {
  console.error(`[backup-db] ❌ 같은 이름의 파일이 이미 있습니다: ${out}`);
  process.exit(1);
}

const live = new PrismaClient();
let copy = null;
try {
  // 경로에 작은따옴표가 들어갈 수 없게 위에서 이름을 제한했다(SQL 문자열로 들어가므로)
  await live.$executeRawUnsafe(`VACUUM INTO '${out}'`);
  copy = new PrismaClient({ datasources: { db: { url: `file:${out}` } } });
  const rows = await copy.$queryRawUnsafe("PRAGMA integrity_check");
  const result = Array.isArray(rows) && rows.length === 1 ? Object.values(rows[0])[0] : JSON.stringify(rows);
  if (result !== "ok") throw new Error(`무결성 검사 실패: ${result}`);
  const companies = await copy.company.count();
  const users = await copy.user.count();
  console.log(`[backup-db] ✅ ${name} (${fs.statSync(out).size} bytes, 회사 ${companies} · 계정 ${users})`);
} catch (e) {
  console.error("[backup-db] ❌ 백업 실패:", e instanceof Error ? e.message : e);
  try { fs.rmSync(out, { force: true }); } catch { /* 지우기 실패는 아래 종료코드로 충분 */ }
  process.exitCode = 1;
} finally {
  await live.$disconnect();
  if (copy) await copy.$disconnect();
}
