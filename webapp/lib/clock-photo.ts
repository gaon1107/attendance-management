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

// 이 사진이 보관기간을 넘겼는가 — **파기 작업이 실제로 돌았는지와 무관하게** 날짜만으로 판정한다.
//  🔴 이 함수가 필요한 이유(검수 치명 1): 열람 API가 "파기 표시(fileDeletedAt)"만 보고 막고 있었는데,
//     그 표시는 파기 작업이 그 사진에 도달해야 찍힌다. 파기를 한 번에 다 하지 않고 나눠 처리하게 되면서
//     "아직 표시가 안 찍힌 만료 사진"이 생길 수 있고, 그 사진은 90일이 지났는데도 열렸다.
//     생체정보 보관기간은 파기 작업 진행 상황에 좌우돼선 안 된다.
export function isPhotoExpired(createdAt: Date, now: Date = new Date()): boolean {
  return createdAt.getTime() < now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

// 사진 보관 문구가 동의 화면에 들어간 날(2026-07-11). 이 시각 "이후" 동의한 직원의 사진만 저장한다.
// (그 전에 동의한 직원은 "사진 90일 보관"에 동의한 적이 없으므로 재동의 전까지 사진을 남기지 않는다 — 법적 안전장치)
// 사용처: 사진 저장 가드(actions/face.ts) + 재동의 안내 배너(출퇴근·인증방식 화면) — 반드시 같은 값이어야 함.
export const PHOTO_CONSENT_SINCE = new Date("2026-07-11T00:00:00+09:00");
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
  const done = await unlinkAndMark(photos);
  if (done > 0) console.log(`[clock-photo] 동의 철회 파기 — 직원 ${userId} 사진 ${done}건 삭제`);
  return done;
}

// 파일을 지우고 "파기 완료" 표시를 남기는 공통 처리(P-4).
//  · 예전엔 사진 한 장마다 UPDATE를 한 번씩 날려, 수천 장이면 쓰기가 수천 번 일어났다.
//    SQLite는 파일 하나에 쓰기가 하나뿐이라 그 사이 다른 요청(출퇴근 등)이 밀린다.
//  · 이제 파일은 하나씩 지우되 표시는 묶어서 한 번에 한다(pcoff-retention.ts와 같은 방식).
//  · 묶음 크기를 100으로 잡은 이유(검수 중간 3): 파일을 먼저 지우고 표시를 나중에 찍으므로,
//    그 사이 서버가 멈추면 "파일은 없는데 표시는 안 된" 행이 묶음 크기만큼 남는다.
//    (순서를 바꾸면 "파기했다고 기록해두고 얼굴 파일은 디스크에 남는" 더 나쁜 상태가 되므로 순서는 유지)
//    열람 API가 그런 행을 만나면 스스로 표시를 맞추지만(자가치유), 애초에 폭을 좁혀 둔다.
const MARK_CHUNK = 100;
async function unlinkAndMark(photos: { id: string; fileName: string }[]): Promise<number> {
  if (photos.length === 0) return 0;
  const dir = storageDir();
  const deletedAt = new Date();
  let marked = 0;
  for (let i = 0; i < photos.length; i += MARK_CHUNK) {
    const chunk = photos.slice(i, i + MARK_CHUNK);
    // 파일이 이미 없어도(수동 삭제 등) 기록은 파기 완료로 맞춘다.
    for (const p of chunk) await fs.unlink(path.join(dir, p.fileName)).catch(() => null);
    const res = await prisma.clockPhoto.updateMany({
      where: { id: { in: chunk.map((p) => p.id) } },
      data: { fileDeletedAt: deletedAt },
    });
    marked += res.count;
  }
  return marked;
}

// [90일 자동 파기] 보관기간 지난 사진 파일을 지우고 fileDeletedAt을 찍는다(기록 행은 보존).
// 별도 스케줄러 없이, 사진 저장/열람 때 하루 1회만 실제로 돈다(과도한 반복 방지).
/** 한 번 실행에서 처리할 최대 건수 — 첫 실행이 길게 잡히지 않도록 나눠 지운다(P-4). */
const PURGE_BATCH = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 아직 남았을 때 "이어서" 도는 간격(검수 중간 4). 0으로 두면 사진을 열 때마다 큰 파기가 붙어 화면이 느려진다. */
const RESUME_COOLDOWN_MS = 60 * 1000;
/** 실패했을 때 다시 시도하는 간격(검수 중간 5). 즉시 재시도는 바쁜 DB를 더 바쁘게 만든다. */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
let lastPurgeAt = 0;
// 다음 실행을 "지금부터 N밀리초 뒤"로 앞당긴다(하루 주기를 그만큼 당겨 놓는 방식).
function scheduleNextIn(now: number, ms: number): void {
  lastPurgeAt = now - (DAY_MS - ms);
}
export async function purgeExpiredPhotos(): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAt < DAY_MS) return; // 하루 1회
  lastPurgeAt = now;

  try {
    const cutoff = new Date(now - RETENTION_DAYS * DAY_MS);
    // 한 번에 가져올 상한 — 첫 실행이 수만 건이어도 요청 하나가 오래 잡히지 않게 나눠 처리한다.
    // 남은 건은 잠시 뒤 이어서 지운다. 인덱스 @@index([fileDeletedAt, createdAt]) 사용.
    // orderBy: 기한을 가장 많이 넘긴 것부터 지운다 — 인덱스 순서와 같아 비용은 없고,
    //          정렬이 없으면 DB가 계획을 바꿀 때 "아무 2000건"이 될 수 있다(검수 중간 7).
    const expired = await prisma.clockPhoto.findMany({
      where: { fileDeletedAt: null, createdAt: { lt: cutoff } },
      select: { id: true, fileName: true },
      orderBy: { createdAt: "asc" },
      take: PURGE_BATCH,
    });
    if (expired.length === 0) return;

    const done = await unlinkAndMark(expired);
    const more = expired.length === PURGE_BATCH ? ` (상한 ${PURGE_BATCH}건 도달 — 나머지는 곧 이어서)` : "";
    console.log(`[clock-photo] 보관기간(${RETENTION_DAYS}일) 지난 사진 ${done}건 파기 완료${more}`);
    // 상한까지 채웠고 **실제로 진행이 있었으면** 잠시 뒤 이어 지운다.
    //  · done > 0 조건(검수 중간 6): 한 건도 표시하지 못했는데 다시 도는 것은 같은 목록을 무한히 다시 집는 것이다.
    // 기준 시각은 "지금 끝난 시각" — 작업이 오래 걸렸을 때 대기시간이 그만큼 깎이지 않게 한다(검수 A).
    if (done > 0 && expired.length === PURGE_BATCH) scheduleNextIn(Date.now(), RESUME_COOLDOWN_MS);
  } catch (e) {
    // 파기 실패가 출퇴근·열람을 막으면 안 됨 — 로그만 남기고 잠시 뒤 재시도(즉시 재시도 금지).
    //  ⚠️ 여기서도 기준은 함수 진입 시각(now)이 아니라 실패가 확정된 "지금"이다(검수 A).
    //     11분간 버티다 실패하면 now 기준 10분 예약은 이미 지난 시각이라 즉시 재시도가 되어버린다.
    scheduleNextIn(Date.now(), RETRY_COOLDOWN_MS);
    console.error("[clock-photo] 자동 파기 실패:", e);
  }
}
