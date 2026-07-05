// 비밀번호 암호화 — Node 내장 crypto(scrypt) 사용. 원문은 저장하지 않고 해시만 저장한다.
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

// 비밀번호 → "소금값:해시값" 문자열
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// 입력한 비밀번호가 저장된 해시와 일치하는지 확인
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const testBuf = scryptSync(password, salt, 64);
  return hashBuf.length === testBuf.length && timingSafeEqual(hashBuf, testBuf);
}
