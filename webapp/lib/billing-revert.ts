// 결제 취소 확정 + 이용 기간 되돌리기를 **한 묶음(트랜잭션)**으로 — 2026-11-23 결제 6단계 검수 중간 1.
//
// 왜 한 묶음인가
//  · 운영자가 결제 완료(paid)였던 결제를 취소하면, KIS 취소가 확정되는 순간(cancel_check → cancelled) 그 결제로 늘어난
//    이용 기간(Company.paidUntil)도 함께 되돌려야 한다. 따로 하면 그 사이(몇 분)에는 "확인 중 결제"가 없어 새 결제가 열리고,
//    새 결제가 **되돌리기 전 기간 뒤에** 붙어 환불한 한 달을 공짜로 쓰게 된다.
//  · 그래서 billing-pay(runCancel)·billing-auto(runBillingCancel)의 "취소 확정" 자리 6곳이 모두 confirmCancelled를 거친다.
//    결제 완료였던 적이 없는 주문(paidAt 없음 — 자동 취소·금액 불일치·해지 회사 등)은 상태만 바뀌고 기간은 건드리지 않는다(예전과 같음).
//
// 되돌리는 조건: 회사의 지금 paidUntil이 그 결제의 periodEnd와 같을 때만(= 맨 끝에 붙은 결제). 아니면 손대지 않고
//  periodRevertedAt을 비워 두어 운영자 [결제] 확인 필요 칸에 "되돌리지 못함"으로 뜬다.
// ⚠️ 이 파일은 billing-pay·billing-auto가 불러 쓴다 → 여기서 그 둘을 **정적으로 불러오지 않는다**(서로 물리는 import).
//    자동결제 결제일 다시 계산(rescheduleCompanyCards)만 함수 안에서 동적으로 불러온다.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { moveOrder } from "@/lib/pg-state";

/** runCancel·runBillingCancel이 KIS의 **확정 거절**을 주문 pgResultMsg에 남길 때의 앞머리(검수 중간 2). 운영자 화면이 이 글자로 찾는다. */
export const CANCEL_REJECT_PREFIX = "KIS 취소 거절";

type Tx = Prisma.TransactionClient | PrismaClient;
export type RevertKind = { kind: "reverted"; companyId: string } | { kind: "gone" } | { kind: "mismatch"; orderNo: string } | { kind: "skip" };

/** 트랜잭션 안에서: 결제 완료였다가 취소된 주문 하나의 이용 기간을 되돌린다(조건은 머리말). */
async function revertInTx(tx: Tx, orderId: string): Promise<RevertKind> {
  const o = await tx.pgOrder.findUnique({
    where: { id: orderId },
    select: { id: true, companyId: true, status: true, paidAt: true, periodEnd: true, prevPaidUntil: true, periodRevertedAt: true, orderNo: true },
  });
  if (!o || o.status !== "cancelled" || !o.paidAt || o.periodRevertedAt) return { kind: "skip" };
  const c = await tx.company.findUnique({ where: { id: o.companyId }, select: { paidUntil: true } });
  const now = new Date();
  if (!c) {
    // 회사가 파기됨 — 되돌릴 기간이 없다.
    await tx.pgOrder.updateMany({ where: { id: o.id, periodRevertedAt: null }, data: { periodRevertedAt: now } });
    return { kind: "gone" };
  }
  if (!o.periodEnd || !c.paidUntil || c.paidUntil.getTime() !== o.periodEnd.getTime()) return { kind: "mismatch", orderNo: o.orderNo };
  // 읽은 값 그대로일 때만(그사이 다른 결제가 기간을 늘렸으면 손대지 않는다).
  const changed = await tx.company.updateMany({ where: { id: o.companyId, paidUntil: o.periodEnd }, data: { paidUntil: o.prevPaidUntil } });
  if (changed.count !== 1) return { kind: "mismatch", orderNo: o.orderNo };
  await tx.pgOrder.updateMany({ where: { id: o.id, periodRevertedAt: null }, data: { periodRevertedAt: now } });
  return { kind: "reverted", companyId: o.companyId };
}

// 되돌리지 못한 건은 여러 번 볼 수 있다 — 같은 경고는 서버가 켜진 동안 한 번만(기록이 쌓이지 않게).
const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  if (warned.size > 500) warned.clear();
  warned.add(key);
  console.error(msg);
}

/** 트랜잭션이 끝난 뒤 할 일 — 되돌렸으면 자동결제 다음 결제일을 다시 계산, 못 되돌렸으면 경고. */
async function afterRevert(orderId: string, r: RevertKind): Promise<void> {
  if (r.kind === "mismatch") {
    warnOnce(orderId, `[billing-revert] [운영자 확인 필요] 취소된 결제 ${r.orderNo}의 이용 기간을 되돌리지 못함 — 뒤에 다른 결제가 있거나 기간이 바뀜`);
  }
  if (r.kind === "reverted") {
    try {
      const { rescheduleCompanyCards } = await import("@/lib/billing-auto");
      await rescheduleCompanyCards(r.companyId);
    } catch (e) {
      console.error(`[billing-revert] [운영자 확인 필요] 기간 되돌린 뒤 자동결제 결제일 다시 계산 실패(ID ${r.companyId.slice(0, 8)}): ${e instanceof Error ? e.name : "unknown"}`);
    }
  }
}

/**
 * cancel_check → cancelled(취소 확정)와 기간 되돌리기를 한 묶음으로. billing-pay·billing-auto의 취소 확정 자리가 부른다.
 * @returns 상태가 실제로 바뀌었으면 true(moveOrder와 같은 뜻)
 */
export async function confirmCancelled(orderId: string, data: Prisma.PgOrderUpdateManyMutationInput): Promise<boolean> {
  const r = await prisma.$transaction(async (tx) => {
    const moved = await moveOrder(tx, orderId, ["cancel_check"], "cancelled", data);
    if (!moved) return { moved: false, rev: { kind: "skip" } as RevertKind };
    return { moved: true, rev: await revertInTx(tx, orderId) };
  });
  if (r.moved) await afterRevert(orderId, r.rev);
  return r.moved;
}

/** 이미 취소 확정된 주문의 기간 되돌리기만(운영자 [다시 되돌리기]·확인한 대로 닫기 뒤·예전 데이터). */
export async function revertPaidCancel(orderId: string): Promise<RevertKind["kind"]> {
  const r = await prisma.$transaction((tx) => revertInTx(tx, orderId));
  await afterRevert(orderId, r);
  return r.kind;
}
