// [신청서 첨부파일 저장소] — 외출/외근·재택·초과근무·출장 신청에 붙이는 파일.
//   저장: 웹 공개경로 밖(storage/request-attachments/{companyId}/)에 파일로 보관.
//   열람: 인증 route에서만 — 회사격리 + (신청자 본인/관리자/결재자) 확인 후 스트림.
//   ※ 파일 형식/크기 검증(detectMime·MAX_SIZE)과 허용목록(ALLOWED)은 회사문서와 동일 정책을 재사용한다.
//   ※ 파일명은 우리가 만든 난수만 사용(경로 조작 차단). companyId도 형식 검증.
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { ALLOWED, type AllowedMime } from "@/lib/company-doc";

// 첨부 가능한 신청 유형(사장님 결정: 이번에 만든 4종만).
export const ATTACHABLE_TYPES = ["outing", "remote", "overtime", "trip"] as const;
export type AttachableType = (typeof ATTACHABLE_TYPES)[number];
export function isAttachableType(t: string): t is AttachableType {
  return (ATTACHABLE_TYPES as readonly string[]).includes(t);
}

// 신청 1건당 첨부 최대 개수.
export const MAX_FILES = 5;

// cuid 형식(영숫자)만 허용 — 경로 조작 방지.
function safeId(id: string): string {
  if (!/^[a-z0-9]+$/i.test(id)) throw new Error("잘못된 식별자입니다.");
  return id;
}

// 저장 폴더 — 운영에선 .env REQUEST_ATTACHMENT_DIR(절대경로) 권장. 미설정 시 dev 편의로 webapp/storage를 찾는다.
function storageRoot(): string {
  const fixed = process.env.REQUEST_ATTACHMENT_DIR;
  if (fixed && fixed.trim()) return fixed.trim();
  const base = path.basename(process.cwd()) === "webapp" ? process.cwd() : path.join(process.cwd(), "webapp");
  return path.join(base, "storage", "request-attachments");
}

function companyDir(companyId: string): string {
  return path.join(storageRoot(), safeId(companyId));
}

// 저장된 파일 이름 검증(경로 구분자·상위 이동 차단).
function assertStoredName(storedName: string): void {
  if (!/^[0-9a-f-]+\.(pdf|jpg|png)$/i.test(storedName)) throw new Error("잘못된 파일 이름입니다.");
}

// 파일을 저장하고 저장 파일명을 돌려준다.
export async function saveAttachmentFile(companyId: string, buffer: Buffer, mime: AllowedMime): Promise<string> {
  const dir = companyDir(companyId);
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}.${ALLOWED[mime]}`;
  await fs.writeFile(path.join(dir, storedName), buffer);
  return storedName;
}

// 저장 파일을 읽어 돌려준다(인증 다운로드 route에서만 호출).
export async function readAttachmentFile(companyId: string, storedName: string): Promise<Buffer> {
  assertStoredName(storedName);
  return fs.readFile(path.join(companyDir(companyId), storedName));
}

// 저장 파일을 삭제한다(첨부 삭제·신청 취소 시). 파일이 이미 없어도 조용히 넘어간다.
//
// 결과를 돌려주는 이유(검수 중간 2·3): 3년 파기가 "실제로 지운 파일 수"를 파기 대장에 남기고,
// **지우지 못한 첨부가 있으면 그 신청을 이번 회차에 지우지 않기** 위해서다(행만 지우면 주인 없는 파일이 남는다).
// ※ 기존 호출부(신청 취소·첨부 삭제)는 반환값을 쓰지 않는다 — 그대로 동작한다(순수 확장).
export type FileDeleteOutcome =
  | "deleted"  // 이번에 실제로 지움
  | "absent"   // 이미 없음(정상) 또는 이름이 우리 규칙과 달라 애초에 찾을 수 없음
  | "failed";  // 지우려 했으나 실패 — 재시도 가치가 있다
export async function deleteAttachmentFile(companyId: string, storedName: string): Promise<FileDeleteOutcome> {
  let dir: string;
  try {
    assertStoredName(storedName);
    // ⚠️ companyDir도 여기서 부른다(safeId가 던진다). 아래 try 안에서 부르면 그 예외가 unlink 실패로 둔갑해
    //    "failed"가 나가고, 그 신청은 영원히 파기되지 않는다.
    dir = companyDir(companyId);
  } catch {
    // 이름·식별자가 우리 규칙과 다르면 손대지 않는다. failed가 아니라 absent로 보는 이유는 clock-photo와 같다 —
    // 영원히 찾을 수 없는 파일을 실패로 처리하면 그 신청이 영원히 파기되지 않는다.
    return "absent";
  }
  try {
    await fs.unlink(path.join(dir, storedName));
    return "deleted";
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "failed";
  }
}
