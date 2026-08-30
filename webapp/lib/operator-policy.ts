// 운영자(본사) 계정의 비밀번호 찍기 방어 — **잠금은 이제 여기에만 남아 있다.**
//
// ⚠️ 2026-08-30(H-1)에 전제가 바뀌었다. 예전에는 *"정책 숫자를 고객사와 같은 것을 쓴다"*였는데,
//    **고객사 계정에서는 잠금이 폐지됐다**(lib/login-policy.ts 상단에 이유가 길게 적혀 있다).
//    그래서 이 파일의 잠금은 고객사와 같은 정책이 아니라 **운영자 전용 정책**이다.
//    · 운영자에게만 남긴 이유: 쓰는 사람이 한두 명이라 잠금의 부작용이 없고,
//      잠겨도 `scripts/create-operator.mjs --unlock` 으로 풀 수 있어 **영구 잠김이 아니다.**
//      (고객사 회사 계정은 풀어 줄 사람이 아무도 없어서 문제였다 — 그게 H-1이다)
//
// 🔴 왜 lib/login-policy.ts 의 함수를 그대로 쓰지 못하나
//    그쪽 `recordFail`/`recordSuccess`는 `db.user` 표를 직접 고치도록 만들어져 있다(타입도 그렇다).
//    운영자는 다른 표(Operator)라 그 함수가 닿지 않는다.
//    → "어느 표에 쓰는가"를 여기서 바꾼다. 지금은 그쪽에서 `lockRemainMinutes`만 가져다 쓴다
//      (숫자는 위 경고대로 **이 파일이 유일한 출처**다).
//
// 🔴 쓰기 방식은 여전히 **원자적이어야 한다.** 두 가지 구멍을 이렇게 막는다:
//    ① 잠금이 지워지는 구멍 — 비밀번호 대조(scrypt, 수십 ms) 사이에 다른 요청이 잠금을 걸 수 있다.
//       그래서 "지금 잠겨 있지 않은 행"을 **where 조건에 넣어 DB가 판단**하게 한다.
//    ② 잠금이 안 걸리는 구멍 — 읽은 횟수에 1을 더해 쓰면 동시 50건이 모두 같은 값을 써서
//       50번 틀렸는데 횟수는 1이 된다. 그래서 더하기를 **DB의 increment**에 맡긴다.
//    상세한 이유는 lib/login-policy.ts 의 recordFail 주석에 있다(같은 사고를 두 번 적지 않는다).
import { Prisma } from "@prisma/client";

// ── 잠금 정책 숫자. **여기가 유일한 출처다** (2026-08-30 H-1 후속 검수 중간 7). ──
//  · 원래는 lib/login-policy.ts(고객사 정책)에서 가져다 썼다. 그런데 H-1으로 **고객사에서는
//    잠금이 없어져** 그 숫자가 사실상 운영자 전용이 됐다. 남의 집에 두면, 나중에 누가
//    "고객사 잠금을 3회로 조이자"며 그 숫자를 고쳤을 때 **운영자 계정이 조용히 3회에 잠긴다.**
//  · 운영자에게 잠금을 남겨 둔 이유: 쓰는 사람이 한두 명이라 부작용이 없고,
//    잠겨도 `scripts/create-operator.mjs --unlock` 으로 풀 수 있어 **영구 잠김이 아니다**
//    (고객사 회사 계정은 풀어 줄 사람이 없어서 문제였다 — 그게 H-1이다).
export const MAX_FAILED = 5; // 연속 5회 실패하면
export const LOCK_MINUTES = 10; // 10분간 잠금

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

// ════════════════════════════════════════════════════════════════════════════
//  이 문 전체의 초당 상한 — **고객 서비스를 지키는 장치**다 (검수 M-3)
//
// 🔴 왜 필요한가
//    기존 IP 단위 제한(lib/login-throttle.ts)은 접속자 IP를 알아야 작동하는데, IP는
//    `TRUST_PROXY=1`(.env)일 때만 읽힌다(lib/ip.ts). 프록시를 세우기 전까지 그 제한은
//    **아무 일도 하지 않고**, 거부 기록조차 남지 않는다(IP가 없으면 recordThrottleHit이 그냥 돌아간다).
//    그 상태에서 이 문에 로그인 요청을 쏟으면 요청 1건마다
//      ① scrypt 1회 — 약 40ms 동안 **서버 전체가 멈춘다**(동기 연산)
//      ② 접속기록 1행 — 2년 보관
//    가 생긴다. 초당 25건이면 서버가 사실상 정지 = **직원들이 출퇴근을 찍지 못한다.**
//    운영자 한 문 때문에 고객 서비스가 멈추는 것은 어떤 경우에도 안 된다.
//
// 🔴 왜 이런 방식(프로세스 메모리)인가
//    DB를 세는 방식은 "세는 것 자체가 DB 부하"라 폭주 상황에서 역효과다. 이건 **DB에 닿기 전에**
//    끊는 것이 목적이므로 메모리에서 세야 한다.
//    · 한계: 서버를 여러 대로 늘리면 대당 상한이 된다(대수만큼 곱해진다). 재시작하면 초기화된다.
//      그래도 "아무 상한도 없음"보다 압도적으로 낫고, 진짜 방어는 배포 때 프록시에서 이 경로를
//      사내 IP로 제한하는 것이다(docs/09_test/배포전_체크리스트.md).
//
// ⚠️ 숫자 근거: 이 문을 쓰는 사람은 **한두 명**이다. 1분에 30번을 넘길 이유가 없다
//    (오타로 5회 틀리면 어차피 계정이 10분 잠긴다). 정상 사용자가 여기 걸릴 일은 없다.
const DOOR_WINDOW_MS = 60 * 1000;
const DOOR_MAX_PER_WINDOW = 30;
/** 최근 시도 시각들(밀리초). 창을 벗어난 것은 볼 때마다 버린다 — 무한히 자라지 않는다. */
let doorHits: number[] = [];

/**
 * 지금 이 문이 로그인 시도를 하나 더 받아도 되는가.
 * **시도 자체를 세므로 호출하면 1건이 기록된다** — 비밀번호를 대조하기 전에 딱 한 번 부른다.
 * @returns 받아도 되면 true, 상한을 넘었으면 false(호출부는 대조 없이 거부한다)
 */
export function operatorDoorAllows(now: number = Date.now()): boolean {
  const cutoff = now - DOOR_WINDOW_MS;
  // 창을 벗어난 기록 버리기 — 배열은 시간순이라 앞에서부터 자르면 된다.
  let i = 0;
  while (i < doorHits.length && doorHits[i] < cutoff) i++;
  if (i > 0) doorHits = doorHits.slice(i);

  if (doorHits.length >= DOOR_MAX_PER_WINDOW) return false;
  doorHits.push(now);
  return true;
}
