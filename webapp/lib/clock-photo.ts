// [출퇴근 촬영 사진 저장소] — 생체정보 보호 장치 (확정 2026-07-11)
//   저장: AES-256-GCM 암호화 후 웹 공개경로 밖(storage/clock-photos/)에 파일로 보관
//   열람: 관리자 전용 API(route)에서만 복호화 (열람 기록은 DB에 남김)
//   파기: 90일 지난 사진 파일 자동 삭제(점수·판독 기록 행은 보존, fileDeletedAt 표시)
// 키는 .env CLOCK_PHOTO_KEY(64자리 hex = 32바이트)에만 둔다. 코드·문서에 기록 금지.
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { prisma } from "@/lib/db";

const RETENTION_DAYS = 90; // 보관기간(일) — 사장님 확정 2026-07-11. 변경 시 동의 문구(consent)도 함께 갱신할 것.
const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM 권장 IV 길이
const TAG_LEN = 16;

function encryptionKey(): Buffer {
  const hex = process.env.CLOCK_PHOTO_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("CLOCK_PHOTO_KEY(.env)가 없거나 형식이 아닙니다(64자리 hex 필요).");
  }
  return Buffer.from(hex, "hex");
}

// 저장 폴더 — 운영에서는 .env CLOCK_PHOTO_DIR(절대경로)로 고정 권장(배포 방식이 바뀌어도 사진 유실 방지).
// 미설정 시 dev 편의: cwd가 상위 폴더여도 webapp/storage를 찾는다.
function storageDir(): string {
  const fixed = process.env.CLOCK_PHOTO_DIR;
  if (fixed && fixed.trim()) return fixed.trim();
  const base = path.basename(process.cwd()) === "webapp"
    ? process.cwd()
    : path.join(process.cwd(), "webapp");
  return path.join(base, "storage", "clock-photos");
}

// 사진(JPEG)을 암호화해 저장하고 파일 이름을 돌려준다. 파일 형식: [IV 12][GCM 태그 16][암호문]
export async function saveClockPhoto(imageBuffer: Buffer): Promise<string> {
  const key = encryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(imageBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  const dir = storageDir();
  await fs.mkdir(dir, { recursive: true });
  // 파일 이름은 추측 불가능한 난수(경로 조작 여지 차단: 우리가 만든 이름만 사용)
  const fileName = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}.enc`;
  await fs.writeFile(path.join(dir, fileName), Buffer.concat([iv, tag, enc]));
  return fileName;
}

// 암호화 파일을 복호화해 JPEG 원본을 돌려준다. (관리자 열람 API에서만 호출)
export async function readClockPhoto(fileName: string): Promise<Buffer> {
  // DB에서 온 이름이라도 방어: 경로 구분자·상위 이동이 섞여 있으면 거부
  if (!/^[0-9a-f-]+\.enc$/i.test(fileName)) throw new Error("잘못된 사진 파일 이름입니다.");
  const raw = await fs.readFile(path.join(storageDir(), fileName));
  if (raw.length < IV_LEN + TAG_LEN + 1) throw new Error("사진 파일이 손상되었습니다.");
  const key = encryptionKey();
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

// [동의 철회 파기] 해당 직원의 보관 중인 사진 파일을 전부 즉시 삭제한다(기록 행은 보존, fileDeletedAt 표시).
// 동의 화면의 "언제든 철회·삭제 요청 가능" 약속 이행 — 철회(withdrawBiometric 등) 시 호출.
export async function purgeUserPhotos(userId: string): Promise<number> {
  const photos = await prisma.clockPhoto.findMany({
    where: { userId, fileDeletedAt: null },
    select: { id: true, fileName: true },
  });
  const dir = storageDir();
  for (const p of photos) {
    await fs.unlink(path.join(dir, p.fileName)).catch(() => null); // 파일이 이미 없어도 기록은 파기 완료로
    await prisma.clockPhoto.update({ where: { id: p.id }, data: { fileDeletedAt: new Date() } });
  }
  if (photos.length > 0) console.log(`[clock-photo] 동의 철회 파기 — 직원 ${userId} 사진 ${photos.length}건 삭제`);
  return photos.length;
}

// [90일 자동 파기] 보관기간 지난 사진 파일을 지우고 fileDeletedAt을 찍는다(기록 행은 보존).
// 별도 스케줄러 없이, 사진 저장/열람 때 하루 1회만 실제로 돈다(과도한 반복 방지).
let lastPurgeAt = 0;
export async function purgeExpiredPhotos(): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAt < 24 * 60 * 60 * 1000) return; // 하루 1회
  lastPurgeAt = now;

  try {
    const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await prisma.clockPhoto.findMany({
      where: { fileDeletedAt: null, createdAt: { lt: cutoff } },
      select: { id: true, fileName: true },
    });
    if (expired.length === 0) return;

    const dir = storageDir();
    for (const p of expired) {
      // 파일이 이미 없어도(수동 삭제 등) 기록은 파기 완료로 맞춘다
      await fs.unlink(path.join(dir, p.fileName)).catch(() => null);
      await prisma.clockPhoto.update({ where: { id: p.id }, data: { fileDeletedAt: new Date() } });
    }
    console.log(`[clock-photo] 보관기간(${RETENTION_DAYS}일) 지난 사진 ${expired.length}건 파기 완료`);
  } catch (e) {
    // 파기 실패가 출퇴근·열람을 막으면 안 됨 — 로그만 남기고 다음 기회에 재시도
    lastPurgeAt = 0;
    console.error("[clock-photo] 자동 파기 실패:", e);
  }
}
