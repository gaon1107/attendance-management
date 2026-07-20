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
export async function deleteAttachmentFile(companyId: string, storedName: string): Promise<void> {
  try {
    assertStoredName(storedName);
  } catch {
    return; // 이름이 이상하면 손대지 않음
  }
  await fs.unlink(path.join(companyDir(companyId), storedName)).catch(() => null);
}
