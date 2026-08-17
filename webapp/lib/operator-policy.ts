// 운영자(본사) 계정의 비밀번호 찍기 방어 — **정책 숫자는 고객사와 같은 것을 쓴다.**
//
// 🔴 왜 lib/login-policy.ts 의 함수를 그대로 쓰지 못하나
//    그쪽 `recordFail`/`recordSuccess`는 `db.user` 표를 직접 고치도록 만들어져 있다(타입도 그렇다).
//    운영자는 다른 표(Operator)라 그 함수가 닿지 않는다.
//    → **숫자와 판정 함수는 그쪽에서 가져오고**(MAX_FAILED·LOCK_MINUTES·lockRemainMinutes),
//      "어느 표에 쓰는가"만 여기서 바꾼다. 숫자를 여기 다시 적으면 그 순간 정책이 갈린다
//      (login-policy.ts 주석의 검수 N-2가 바로 그 사고였다).
//
// 🔴 쓰기 방식도 그쪽과 **똑같아야 한다.** 두 가지 구멍을 같은 방법으로 막는다:
//    ① 잠금이 지워지는 구멍 — 비밀번호 대조(scrypt, 수십 ms) 사이에 다른 요청이 잠금을 걸 수 있다.
//       그래서 "지금 잠겨 있지 않은 행"을 **where 조건에 넣어 DB가 판단**하게 한다.
//    ② 잠금이 안 걸리는 구멍 — 읽은 횟수에 1을 더해 쓰면 동시 50건이 모두 같은 값을 써서
//       50번 틀렸는데 횟수는 1이 된다. 그래서 더하기를 **DB의 increment**에 맡긴다.
//    상세한 이유는 lib/login-policy.ts 의 recordFail 주석에 있다(같은 사고를 두 번 적지 않는다).
import { Prisma } from "@prisma/client";
import { MAX_FAILED, LOCK_MINUTES } from "@/lib/login-policy";

/** 이 함수들이 받는 DB 손잡이 — `prisma`도 트랜잭션 안의 `tx`도 그대로 넘길 수 있다. */
type Db = Pick<Prisma.TransactionClient, "operator">;

/** "지금 잠겨 있지 않은 행"을 가리키는 조건 — 모든 쓰기에 이 조건을 건다. */
function notLocked(now: Date) {
  return { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
}

/**
 * 운영자 비밀번호 실패 1회를 **DB가 세도록** 기록한다.
 * @returns 실제로 셌으면 true(이미 잠겨 있어 아무것도 하지 않았으면 false).
 */
export async function recordOperatorFail(
  db: Db,
  op: { id: string; lockedUntil?: Date | null },
  now: Date = new Date()
): Promise<boolean> {
  // 빠른 길: 읽어둔 값이 이미 "잠김"이면 DB를 건드리지 않는다.
  //  · 정확성은 아래 where 조건이 책임진다. 이건 순전히 쓰기 트랜잭션을 아끼는 용도다
  //    — 잠긴 계정을 계속 두드릴 때 SQLite 쓰기 락이 **직원들의 출퇴근 기록과 경합**하지 않게 한다.
  if (op.lockedUntil && op.lockedUntil > now) return false;

  // ① 원자적 증가 — 동시 요청이 서로를 덮어쓸 수 없다.
  const bumped = await db.operator.updateMany({
    where: { id: op.id, ...notLocked(now) },
    data: { failedLoginCount: { increment: 1 } },
  });
  if (bumped.count === 0) return false; // 그 사이에 잠겼다 → 아무것도 하지 않는다

  // ② 문턱을 넘었으면 잠근다. 넘었는지도 DB가 판단하므로 동시 요청 중 **딱 하나만** 잠근다.
  //    ⚠️ 잠글 때 횟수를 0으로 되돌린다 — 5로 남기면 잠금이 풀린 사람이 한 번만 더 틀려도
  //       즉시 다시 잠겨 사실상 영구히 못 들어온다(login-policy.ts 검수 N-2와 같은 이유).
  await db.operator.updateMany({
    where: { id: op.id, failedLoginCount: { gte: MAX_FAILED }, ...notLocked(now) },
    data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) },
  });
  return true;
}

/**
 * 비밀번호가 맞았을 때 실패 기록을 되돌리고 마지막 로그인 시각을 남긴다.
 *
 * ⚠️ 여기에도 `notLocked` 조건을 건다 — 실패 쪽만 원자적으로 고치고 성공 쪽을 그냥 update로 두면
 *    **비밀번호를 맞힌 요청이 그 사이에 걸린 잠금을 지우는** 같은 모양의 구멍이 남는다.
 *    잠긴 계정은 비밀번호가 맞아도 거부하는 것이 이 저장소의 원칙이므로, 잠겨 있는 동안에는
 *    초기화도 하지 않는다(호출부가 잠금을 먼저 확인해 거부한다).
 */
export async function recordOperatorSuccess(db: Db, operatorId: string, now: Date = new Date()): Promise<void> {
  await db.operator.updateMany({
    where: { id: operatorId, ...notLocked(now) },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
}
