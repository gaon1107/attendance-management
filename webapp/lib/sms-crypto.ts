// 회사별 문자 계정 비밀번호 암·복호화 (AES-256-GCM) — 서버 전용.
//
// 왜 필요한가 (2026-11-21, 메시지 관리 1단계)
//  · 비즈모아샷은 발송 순간 비밀번호 **원문**이 필요하다(매뉴얼 방식 commType=0 + pwd). 그래서 되돌릴 수 없는
//    해시(scrypt·MD5)로는 저장할 수 없고, 되돌릴 수 있는 암호화로 저장한 뒤 **발송 순간에만** 푼다.
//  · 학원관리(newgaon-LMS backend/utils/smsCrypto.js)와 **같은 형식**이다. 두 제품의 저장값을 같은 규칙으로 읽을 수 있다.
//
// 저장 형식: enc:v1:<iv(base64)>:<tag(base64)>:<암호문(base64)>
//  · ⚠️ 학원관리와 다른 점 하나: 학원관리는 접두어가 없으면 "구버전 평문"으로 보고 그대로 돌려준다(무중단 전환용).
//    근태는 처음부터 암호문으로만 저장하므로 **접두어가 없으면 쓸 수 없는 값(null)**으로 본다 — 평문이 섞일 길을 막는다.
//
// 키: 환경변수 SMS_CRED_KEY 하나. 32바이트를 16진수 64자 또는 base64로 적는다. 코드에 하드코딩 금지(사규 8).
//  · 만들기: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//  · ⚠️ 키를 잃어버리면 저장된 비밀번호를 영영 풀 수 없다 → 운영 .env와 함께 따로 보관.
//  · ⚠️ 키를 바꾸면 이미 저장된 값은 전부 해독 실패 → 회사들이 [설정 → 문자·알림톡]에서 비밀번호를 다시 넣어야 한다.
//
// 실패 규칙
//  · 암호화: 키가 없으면 예외를 던진다(평문 저장으로 조용히 후퇴하지 않는다).
//  · 복호화: 키가 없거나 값이 손상됐으면 null. 부르는 쪽은 null을 "계정을 쓸 수 없음"으로 다룬다.
//  · 어떤 경우에도 비밀번호·키를 로그에 남기지 않는다.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export const SMS_CRYPTO_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 권장 IV 길이
const TAG_BYTES = 16; // GCM 인증 태그 길이(고정)
const KEY_BYTES = 32; // AES-256

/** 환경변수에서 32바이트 키를 읽는다. 없거나 형식이 틀리면 null. */
function loadKey(): Buffer | null {
  const raw = process.env.SMS_CRED_KEY;
  if (!raw || raw.trim() === "") return null;
  const s = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  // base64는 글자 집합을 먼저 검사한다 — Buffer.from은 엉뚱한 글자를 조용히 무시해 오타 난 키도 32바이트로 풀리기 때문.
  if (/^[A-Za-z0-9+/]{43}=?$/.test(s)) {
    const b64 = Buffer.from(s, "base64");
    if (b64.length === KEY_BYTES) return b64;
  }
  return null;
}

/** 암호화 키가 올바르게 설정돼 있는가. */
export function hasSmsCryptoKey(): boolean {
  return loadKey() !== null;
}

/** 저장값이 이 모듈의 암호문 형식인가. */
export function isSmsEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SMS_CRYPTO_PREFIX);
}

/** 평문 비밀번호 → 암호문. 키가 없으면 예외(평문 저장으로 후퇴하지 않는다). */
export function encryptSmsPassword(plain: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error("SMS_CRED_KEY가 설정되지 않았거나 형식이 틀립니다(32바이트 16진수 64자). 서버 .env를 확인하세요.");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SMS_CRYPTO_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * 암호문 → 평문. 쓸 수 없으면 null.
 *  · null/빈 값 → null(계정 없음)
 *  · 접두어 없음 → null(근태는 평문을 저장한 적이 없다 — 머리말 참고)
 *  · 키 없음·키가 바뀜·값 손상 → null
 */
export function decryptSmsPassword(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isSmsEncrypted(stored)) {
    console.error("[sms-crypto] 문자 계정 비밀번호가 암호문 형식이 아니다 — 쓰지 않는다.");
    return null;
  }
  const key = loadKey();
  if (!key) {
    console.error("[sms-crypto] 문자 계정 비밀번호 해독 실패: SMS_CRED_KEY가 없다. 서버 .env를 확인할 것.");
    return null;
  }
  try {
    const parts = stored.slice(SMS_CRYPTO_PREFIX.length).split(":");
    if (parts.length !== 3) throw new Error("형식 오류");
    const [ivB64, tagB64, dataB64] = parts;
    const tag = Buffer.from(tagB64, "base64");
    if (tag.length !== TAG_BYTES) throw new Error("태그 길이 오류");
    // authTagLength를 고정해 짧게 잘린 태그가 검증을 통과하지 못하게 한다.
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"), { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    // 키가 바뀌었거나 값이 손상됐다. 값·키는 찍지 않는다.
    console.error("[sms-crypto] 문자 계정 비밀번호 해독 실패: 키가 바뀌었거나 저장값이 손상됐다. 회사가 비밀번호를 다시 넣어야 한다.");
    return null;
  }
}
