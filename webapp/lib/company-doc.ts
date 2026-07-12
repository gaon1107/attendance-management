// [회사 첨부문서 저장소] — 사업자등록증·통장사본 등.
//   저장: 웹 공개경로 밖(storage/company-docs/{companyId}/)에 파일로 보관. (생체정보가 아니라 암호화는 안 함)
//   열람: 관리자 전용 API(route)에서만 — 회사 격리·인증 확인 후 스트림.
//   ※ 파일명은 우리가 만든 난수만 사용(경로 조작 차단). companyId도 형식 검증.
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

// 허용 파일 형식: PDF · JPG · PNG
export const ALLOWED = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;
export type AllowedMime = keyof typeof ALLOWED;
export const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// 문서 종류(kind) — MES 예시와 동일. UI 표시 라벨 포함.
export const DOC_KINDS: { key: string; label: string }[] = [
  { key: "bizReg", label: "사업자등록증" },
  { key: "seal", label: "인감 스캔본" },
  { key: "bankbook", label: "통장 사본" },
  { key: "factory", label: "공장등록증" },
  { key: "etc", label: "기타 문서" },
];
export const DOC_KIND_KEYS = DOC_KINDS.map((d) => d.key);

// cuid 형식(영숫자)만 허용 — 경로 조작 방지.
function safeId(id: string): string {
  if (!/^[a-z0-9]+$/i.test(id)) throw new Error("잘못된 식별자입니다.");
  return id;
}

// 저장 폴더 — 운영에선 .env COMPANY_DOC_DIR(절대경로) 권장. 미설정 시 dev 편의로 webapp/storage를 찾는다.
function storageRoot(): string {
  const fixed = process.env.COMPANY_DOC_DIR;
  if (fixed && fixed.trim()) return fixed.trim();
  const base = path.basename(process.cwd()) === "webapp" ? process.cwd() : path.join(process.cwd(), "webapp");
  return path.join(base, "storage", "company-docs");
}

function companyDir(companyId: string): string {
  return path.join(storageRoot(), safeId(companyId));
}

// 저장된 파일 이름 검증(경로 구분자·상위 이동 차단).
function assertStoredName(storedName: string): void {
  if (!/^[0-9a-f-]+\.(pdf|jpg|png)$/i.test(storedName)) throw new Error("잘못된 파일 이름입니다.");
}

// 파일을 저장하고 저장 파일명을 돌려준다.
export async function saveCompanyDoc(companyId: string, buffer: Buffer, mime: AllowedMime): Promise<string> {
  const dir = companyDir(companyId);
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}.${ALLOWED[mime]}`;
  await fs.writeFile(path.join(dir, storedName), buffer);
  return storedName;
}

// 저장 파일을 읽어 돌려준다(관리자 다운로드 API에서만 호출).
export async function readCompanyDoc(companyId: string, storedName: string): Promise<Buffer> {
  assertStoredName(storedName);
  return fs.readFile(path.join(companyDir(companyId), storedName));
}

// 저장 파일을 삭제한다(문서 삭제·교체 시). 파일이 이미 없어도 조용히 넘어간다.
export async function deleteCompanyDocFile(companyId: string, storedName: string): Promise<void> {
  try {
    assertStoredName(storedName);
  } catch {
    return; // 이름이 이상하면 손대지 않음
  }
  await fs.unlink(path.join(companyDir(companyId), storedName)).catch(() => null);
}
