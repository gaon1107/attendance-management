// 임시 비밀번호 생성 — 관리자가 재설정 요청을 처리할 때 쓴다.
// 사람이 옮겨 적기 쉽도록 헷갈리는 글자(0/O, 1/l/I 등)를 뺀 10자리를 만든다.
import { randomInt } from "crypto";

// 대문자·소문자·숫자에서 헷갈리는 글자 제거
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTempPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
