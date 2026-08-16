// 비밀번호 무차별 대입(비번 찍기) 방어 — **단일 출처**.
//
// 왜 lib으로 뺐나: 예전에는 actions/auth.ts 안에만 있었다. 그런데 비밀번호를 확인하는 창구가
// 로그인 말고도 생기면서(계정 설정의 복구용 연락처 변경 등), 그 창구가 자기만의 숫자를 쓰거나
// 아예 제한이 없으면 **로그인 잠금을 우회해 비밀번호를 무제한으로 찍는 구멍**이 된다(검수 M-2).
//
// 🔴 규칙뿐 아니라 **쓰기 자체를 이 파일이 맡는다.** 숫자만 공유하고 "어떻게 쓸지"를 각자 정하면
//    또 갈린다(그게 검수 N-2였다). 실패는 `recordFail`, 성공은 `recordSuccess`만 쓴다.
//
// ⚠️ **아직 예외가 하나 있다**: `app/actions/account.ts`의 `changePassword`는 이 창구를 쓰지 않는다
//    (잠금 확인·횟수 집계·길이 상한이 전부 없다). 모든 직원이 쓰는 강제 비밀번호 변경 흐름이라
//    별도 계획·검증이 필요해 다음 과제로 남겼다. **"모든 창구가 쓴다"고 쓰지 않는 이유가 이것이다.**
import { Prisma } from "@prisma/client";

export const MAX_FAILED = 5; // 연속 5회 실패하면
export const LOCK_MINUTES = 10; // 10분간 잠금

/** 이 함수들이 받는 DB 손잡이 — `prisma`도 트랜잭션 안의 `tx`도 그대로 넘길 수 있다. */
type Db = Pick<Prisma.TransactionClient, "user">;

/** 지금 잠겨 있는가. 잠겨 있으면 남은 분(최소 1)을 돌려준다. */
export function lockRemainMinutes(lockedUntil: Date | null | undefined, now: Date = new Date()): number | null {
  if (!lockedUntil || lockedUntil <= now) return null;
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000));
}

/** "지금 잠겨 있지 않은 행"을 가리키는 조건 — 모든 쓰기에 이 조건을 건다. */
function notLocked(now: Date) {
  return { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
}

/**
 * 비밀번호 실패 1회를 **DB가 세도록** 기록한다.
 *
 * 🔴 왜 이렇게까지 하나 — 두 가지 구멍을 동시에 막아야 하기 때문이다.
 *
 *  ① **"잠금이 지워지는" 구멍** (재검수 치명 1)
 *     실패 판정에 쓰는 사용자 정보는 "읽은 순간의 사진"이고, 그 뒤 비밀번호 대조(scrypt)가
 *     수십 ms 걸린다. 그 사이에 다른 요청이 잠금을 걸었다면, 코드가 "안 잠겼다"고 믿고 쓴 값이
 *     방금 걸린 잠금을 덮어쓴다. → 조건(notLocked)을 **where에 넣어** DB가 판단하게 한다.
 *
 *  ② **"잠금이 안 걸리는" 구멍** (재재검수 치명 1)
 *     예전에는 읽은 횟수에 1을 더해 썼다. 동시에 50건이 들어오면 **50건 모두 같은 숫자를 읽고
 *     모두 같은 숫자를 써서 50번 틀렸는데 횟수는 1**이 된다. 5회 잠금에 닿으려면 250번이 필요해져
 *     사실상 무제한으로 비밀번호를 찍을 수 있다(이 저장소의 유일한 대입 방어가 꺼진다).
 *     → 더하기를 **DB의 increment**에 맡기고, 문턱을 넘었는지도 **DB가 where로 판단**하게 한다.
 *
 * 그래서 두 단계다. 두 단계 사이에서 서버가 죽으면 횟수가 5로 남아 **다음 실패에 잠긴다**
 * — 안전한 쪽으로 틀어지므로 문제되지 않는다.
 *
 * ⚠️ 잠글 때 횟수를 **0으로 되돌린다**(검수 N-2). 5로 남기면 10분 뒤 잠금이 풀린 사람이
 *    한 번만 더 틀려도 즉시 다시 잠겨, 정상 사용자가 사실상 영구히 못 들어온다.
 *
 * @returns 실제로 셌으면 true(이미 잠겨 있어 아무것도 하지 않았으면 false).
 */
export async function recordFail(
  db: Db,
  user: { id: string; lockedUntil?: Date | null },
  now: Date = new Date()
): Promise<boolean> {
  // 빠른 길: 읽어둔 값이 이미 "잠김"이면 DB를 건드리지 않는다.
  //  · 정확성은 아래 where 조건이 책임진다. 이건 순전히 **쓰기 트랜잭션을 아끼는** 용도다
  //    — 잠긴 계정을 계속 두드릴 때 SQLite 쓰기 락이 출퇴근 기록과 경합하지 않게 한다.
  if (lockRemainMinutes(user.lockedUntil, now) !== null) return false;

  // ① 원자적 증가 — 동시 요청이 서로를 덮어쓸 수 없다.
  const bumped = await db.user.updateMany({
    where: { id: user.id, ...notLocked(now) },
    data: { failedLoginCount: { increment: 1 } },
  });
  if (bumped.count === 0) return false; // 그 사이에 잠겼다 → 아무것도 하지 않는다

  // ② 문턱을 넘었으면 잠근다. 넘었는지도 DB가 판단하므로, 동시 요청 중 **딱 하나만** 잠근다.
  await db.user.updateMany({
    where: { id: user.id, failedLoginCount: { gte: MAX_FAILED }, ...notLocked(now) },
    data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) },
  });
  return true;
}

/**
 * 비밀번호가 맞았을 때 실패 기록을 되돌린다.
 *
 * ⚠️ 여기에도 `notLocked` 조건을 건다(재재검수 중간 4). 실패 쪽만 원자적으로 고치고 성공 쪽을
 *    그냥 `update`로 두면, **비밀번호를 맞힌 요청이 그 사이에 걸린 잠금을 지우는** 같은 모양의
 *    구멍이 남는다. 잠긴 계정은 비밀번호가 맞아도 거부하는 것이 이 저장소의 원칙이므로,
 *    잠겨 있는 동안에는 초기화도 하지 않는다.
 */
export async function recordSuccess(db: Db, userId: string, now: Date = new Date()): Promise<void> {
  await db.user.updateMany({
    where: { id: userId, ...notLocked(now) },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}
