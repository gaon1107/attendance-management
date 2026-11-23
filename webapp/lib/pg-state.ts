// 결제 주문(PgOrder) 상태 바꾸기 — **이 파일 한 곳에서만** 한다(2026-11-23 결제 2단계, 1단계 검수 M2-d).
//
// 왜 한 곳인가
//  · SQLite의 CHECK 제약은 Prisma가 표를 다시 만들 때(RedefineTables) 말없이 사라진다. 그래서 규칙을 DB에 두지 않고
//    여기서 지킨다: 허용된 상태 이동만 · 실패·취소로 끝나면 중복 방지 열쇠(cycleKey·firstLiveKey)를 비운다 ·
//    KIS 값의 빈 글자('')는 null로(SQLite는 ''를 null로 보지 않아 유일 조건에 걸린다).
//  · 상태 변경은 언제나 "지금 상태가 X일 때만"(updateMany 조건) — 같은 주문을 두 요청이 두 번 승인·반영하지 않게.
import type { Prisma, PrismaClient } from "@prisma/client";

export const ORDER_STATUS = ["ready", "check", "paid", "failed", "cancel_check", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

/** 허용된 이동. 여기 없는 이동은 예외 — 코드 실수가 조용히 상태를 꼬지 않게. */
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  ready: ["check", "failed"],
  check: ["paid", "failed", "cancel_check", "cancelled"],
  paid: ["cancel_check"], // 운영자 취소(6단계)·반영 실패 뒤 취소
  cancel_check: ["cancelled", "paid"], // paid = 취소 확인 중 "실제로는 취소 안 됨·이미 반영됨"을 운영자가 되돌릴 때(6단계)
  failed: [],
  cancelled: [],
};

/** KIS가 준 글자 — 비었으면 null(빈 글자 저장 금지). 너무 길면 자른다(로그·DB 부풀림 방지). */
export function kisText(v: string | null | undefined, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * 주문 상태를 from → to로 옮긴다. 지금 상태가 from 중 하나일 때만 바뀐다.
 * @returns 실제로 바뀌었으면 true(다른 요청이 먼저 바꿨으면 false)
 */
export async function moveOrder(
  db: Db,
  id: string,
  from: readonly OrderStatus[],
  to: OrderStatus,
  data: Prisma.PgOrderUpdateManyMutationInput = {}
): Promise<boolean> {
  for (const f of from) {
    if (!ALLOWED[f].includes(to)) throw new Error(`[pg-state] 허용되지 않은 결제 상태 이동: ${f} → ${to}`);
  }
  if (typeof data.pgTid === "string" && !data.pgTid.trim()) throw new Error("[pg-state] 빈 거래번호는 저장하지 않는다");
  const ending = to === "failed" || to === "cancelled";
  const r = await db.pgOrder.updateMany({
    where: { id, status: { in: [...from] } },
    data: {
      ...data,
      status: to,
      // 끝난 주문은 중복 방지 열쇠를 놓는다 — 같은 회차·같은 카드의 첫 결제를 다시 시도할 수 있게(1단계 검수 M2-c).
      ...(ending ? { cycleKey: null, firstLiveKey: null } : {}),
    },
  });
  return r.count === 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 자동결제 카드(PgBillingKey) 상태 — 2026-11-23 결제 3단계. 주문과 같은 이유로 **이 파일 한 곳에서만** 바꾼다.
//  · 회사당 사용 중 카드 1장 열쇠(liveKey = companyId)는 active·paused일 때만 값, 그 밖은 null(1단계 검수 M1).
//    → 상태를 옮길 때 이 함수가 열쇠를 함께 맞춘다(부르는 쪽이 잊어 카드 변경이 막히는 일이 없게).
//  · active·paused·deleting이면 bid 필수, failed면 bid 없음, active면 nextChargeDate 필수 — 아래에서 검사한다.
//  · 빌키(bid)는 이미 암호화된 값만 받는다(lib/billing-auto.ts). 빈 글자 금지.
// ─────────────────────────────────────────────────────────────────────────────

export const KEY_STATUS = ["registering", "reg_check", "active", "paused", "deleting", "deleted", "failed"] as const;
export type KeyStatus = (typeof KEY_STATUS)[number];

const KEY_ALLOWED: Record<KeyStatus, readonly KeyStatus[]> = {
  registering: ["reg_check", "failed"],
  reg_check: ["active", "deleting", "failed"], // deleting = 빌키는 받았는데 쓸 수 없게 된 경우(회사 해지 등)
  active: ["paused", "deleting"],
  paused: ["deleting"], // 멈춘 카드를 다시 쓰려면 새로 등록한다(옛 카드는 지운다)
  deleting: ["deleted"],
  deleted: [],
  failed: [],
};

/**
 * 카드 상태를 from → to로 옮긴다. 지금 상태가 from 중 하나일 때만 바뀐다.
 * @param companyId liveKey를 채울 때 쓴다(active·paused로 갈 때 필수)
 * @returns 실제로 바뀌었으면 true
 */
export async function moveKey(
  db: Db,
  id: string,
  from: readonly KeyStatus[],
  to: KeyStatus,
  data: Prisma.PgBillingKeyUpdateManyMutationInput & { companyId?: never } = {},
  companyId?: string
): Promise<boolean> {
  for (const f of from) {
    if (!KEY_ALLOWED[f].includes(to)) throw new Error(`[pg-state] 허용되지 않은 카드 상태 이동: ${f} → ${to}`);
  }
  if (typeof data.bid === "string" && !data.bid.trim()) throw new Error("[pg-state] 빈 빌키는 저장하지 않는다");
  if (typeof data.pgTid === "string" && !data.pgTid.trim()) throw new Error("[pg-state] 빈 거래번호는 저장하지 않는다");
  const live = to === "active" || to === "paused";
  if (live && !companyId) throw new Error("[pg-state] 사용 중 카드는 회사 id가 있어야 한다");
  if (to === "active" && !(data.nextChargeDate instanceof Date)) {
    // paused → active 이동은 없다. active가 되는 것은 등록 확정뿐이고, 그때 결제일을 반드시 잡는다.
    throw new Error("[pg-state] 사용 중 카드는 다음 결제일이 있어야 한다");
  }
  const where: Prisma.PgBillingKeyWhereInput = { id, status: { in: [...from] } };
  // 빌키가 있어야 하는 상태로 가는데 이번에 넣지 않으면, 이미 있는 행만 옮긴다.
  if ((to === "active" || to === "paused" || to === "deleting") && typeof data.bid !== "string") where.bid = { not: null };
  // 실패로 끝나는 것은 빌키가 없을 때만(빌키가 있으면 failed가 아니라 deleting → KIS에서 지운다 — 학원관리와 같은 규칙).
  if (to === "failed") where.bid = null;
  const r = await db.pgBillingKey.updateMany({
    where,
    data: { ...data, status: to, liveKey: live ? companyId : null },
  });
  return r.count === 1;
}
