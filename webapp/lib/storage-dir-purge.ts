// 회사 폴더 하나(storage/…/{회사id}/)의 파일을 전부 지우고 폴더도 지운다 — 해지 회사 파기 전용(2026-11-22 해지 2단계).
//
// 왜 행(DB)마다가 아니라 폴더째 지우나
//  · 신청 첨부·회사 문서는 회사마다 폴더가 따로 있다. DB 행을 따라 하나씩 지우면, 예전 버그·수동 작업으로
//    **DB 행 없이 남은 파일**(주인 없는 개인정보 파일)이 폴더에 영원히 남는다. 회사가 통째로 사라질 때는 폴더째 비운다.
//
// 🔴 이 함수는 폴더 경로를 **받기만** 한다. 경로를 만드는 일(회사 id 검사 포함)은 각 모듈의 companyDir이 한다
//    (lib/request-attachment.ts·lib/company-doc.ts — 저장 위치를 아는 곳이 그 두 파일뿐이어야 .env 경로를 바꿨을 때 어긋나지 않는다).
// 🔴 실패를 삼키지 않고 센다. 하나라도 못 지우면 호출부(lib/company-purge.ts)는 그 회사의 DB를 건드리지 않고 다음 날 다시 한다.
//    (행만 먼저 지우면 "어느 회사 파일인지"라는 단서가 사라진다.)
// ⚠️ 하위 폴더는 만들지 않는 구조다. 혹시 있으면 지우지 않고 실패로 센다(예상 밖의 것을 통째로 지우지 않는다).
import { promises as fs } from "fs";
import path from "path";

export type DirPurgeResult = { deleted: number; failed: number };

export async function purgeDirFiles(dir: string): Promise<DirPurgeResult> {
  const out: DirPurgeResult = { deleted: 0, failed: 0 };
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return out; // 폴더가 원래 없음 = 지울 파일 없음(정상)
    out.failed++;
    return out;
  }
  for (const ent of entries) {
    if (!ent.isFile()) { out.failed++; continue; } // 하위 폴더 등 예상 밖 — 손대지 않는다
    try {
      await fs.unlink(path.join(dir, ent.name));
      out.deleted++;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") out.failed++;
    }
  }
  if (out.failed === 0) {
    try {
      await fs.rmdir(dir); // 빈 폴더만 지워진다(rmdir은 내용이 있으면 실패한다 — 안전장치)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") out.failed++;
    }
  }
  return out;
}
