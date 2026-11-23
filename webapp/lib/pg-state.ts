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
