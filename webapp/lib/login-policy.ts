// 비밀번호 무차별 대입(비번 찍기) 방어 기준 — **단일 출처**.
//
// 왜 lib으로 뺐나: 예전에는 actions/auth.ts 안에만 있었다. 그런데 비밀번호를 확인하는 창구가
// 로그인 말고도 생기면서(계정 설정의 복구용 연락처 변경 등), 그 창구가 자기만의 숫자를 쓰거나
// 아예 제한이 없으면 **로그인 잠금을 우회해 비밀번호를 무제한으로 찍는 구멍**이 된다(검수 M-2).
// 비밀번호를 확인하는 곳은 전부 이 값을 쓴다.
export const MAX_FAILED = 5; // 연속 5회 실패하면
export const LOCK_MINUTES = 10; // 10분간 잠금

/** 지금 잠겨 있는가. 잠겨 있으면 남은 분(최소 1)을 돌려준다. */
export function lockRemainMinutes(lockedUntil: Date | null | undefined, now: Date = new Date()): number | null {
  if (!lockedUntil || lockedUntil <= now) return null;
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000));
}

/** 실패를 1회 더 했을 때의 다음 상태(횟수·잠금해제시각). */
export function nextFailState(failedCount: number, now: Date = new Date()): { failedLoginCount: number; lockedUntil: Date | null } {
  const n = failedCount + 1;
  return { failedLoginCount: n, lockedUntil: n >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) : null };
}
