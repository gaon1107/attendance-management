// 비밀번호 암호화 — Node 내장 crypto(scrypt) 사용. 원문은 저장하지 않고 해시만 저장한다.
//
// 🔴 **비동기다**(보안검수 C-1). 예전에는 `scryptSync`(동기)를 썼는데, 계산이 도는 약 40ms 동안
//    **서버 전체가 멈췄다** — 그 사이 다른 직원의 출퇴근 요청은 한 건도 처리되지 않는다.
//    비동기 `scrypt`는 계산을 **별도 작업 스레드**로 넘기므로 접수 창구(이벤트 루프)가 계속 열려 있다.
//    · 알고리즘·설정(N=16384·r=8·p=1)·저장 형식이 **하나도 바뀌지 않았다.** 만들어지는 해시 값이
//      같으므로 **기존 비밀번호가 그대로 먹힌다**(마이그레이션 없음).
//    · 작업 스레드는 기본 4개다(libuv 기본값). 로그인이 몰리는 규모에서는 서버 환경변수
//      `UV_THREADPOOL_SIZE`로 올린다(배포전 체크리스트 참조).
//
// 🔴 이 파일을 고칠 때 **반드시 지킬 것 두 가지**
//   ① `await`를 한 곳이라도 빠뜨리면 **비밀번호가 틀려도 로그인이 통과한다.**
//      `verifyPassword(...)`가 돌려주는 것은 약속(Promise)이고, 약속은 언제나 "참"이라
//      `if (!verifyPassword(...))`가 **항상 거짓**이 되어 실패 분기를 그냥 지나친다.
//      ⚠️ 이 실수는 `npx tsc --noEmit`도 `npm run lint`도 **잡지 못한다**(둘 다 오류가 아니다).
//      → 고친 뒤에는 **틀린 비밀번호로 실제 로그인해 거부되는지**를 눈으로 확인할 것.
//         (호출부 전수: app/actions 의 auth·account·operator·sms, lib/reset-code.ts)
//   ② 이 파일은 `scripts/*.mjs`가 Node로 **직접** 불러 쓴다. `@/lib/...`(경로 별칭) import를 넣으면
//      그 스크립트들이 즉시 깨진다(scripts/create-operator.mjs 상단 주석 참조).
import { scrypt, randomBytes, timingSafeEqual } from "crypto";

/** scrypt 한 번. 콜백 방식을 약속(Promise)으로 감싼 것뿐이고, 계산 내용은 예전과 완전히 같다. */
function scryptAsync(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, derivedKey) => (err ? reject(err) : resolve(derivedKey)));
  });
}

// 비밀번호 → "소금값:해시값" 문자열
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  return `${salt}:${hash}`;
}

// 입력한 비밀번호가 저장된 해시와 일치하는지 확인
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const testBuf = await scryptAsync(password, salt, 64);
  return hashBuf.length === testBuf.length && timingSafeEqual(hashBuf, testBuf);
}
