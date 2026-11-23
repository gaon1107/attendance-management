"use server";
// 운영자 결제 처리 서버 액션 — 2026-11-23 결제 6단계. 실제 규칙·검사는 lib/billing-operator.ts가 한다(여기는 입력·권한·기록).
//
// 🔴 운영자 로그인은 **여기서 다시** 확인한다(화면을 거치지 않고 직접 불릴 수 있다).
// 🔴 돈이 움직이는 처리라 성공·실패와 상관없이 운영자 기록(접속 기록 config)을 남긴다 — 누가·언제·어느 결제·사유.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentOperator } from "@/lib/operator-session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import {
  operatorCancelOrder, operatorRecheckOrder, operatorCloseOrder, operatorAckRevert, markRegChargeRefunded, type OpResult,
} from "@/lib/billing-operator";

export type OperatorBillingResult = { ok: boolean; message: string } | null;

const ID_RE = /^[a-z0-9]{10,40}$/i;

async function logOperatorBilling(me: { name: string; email: string }, ok: boolean, meta: string): Promise<void> {
  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: null, userId: null, actorName: `운영자 ${me.name}`, emailTried: me.email,
    kind: "config", result: ok ? "success" : "fail", ip, userAgent, meta: meta.slice(0, 300),
  });
}

/** [취소(환불)] — 회사 상세 "결제" 칸. */
export async function cancelPaymentAction(_prev: OperatorBillingResult, formData: FormData): Promise<OperatorBillingResult> {
  const me = await getCurrentOperator();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };
  const orderId = String(formData.get("orderId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const stopAutoPay = formData.get("stopAutoPay") === "1";
  if (!ID_RE.test(orderId) || !ID_RE.test(companyId)) return { ok: false, message: "요청이 올바르지 않습니다." };
  if (reason.length > 300) return { ok: false, message: "취소 사유는 100자 안으로 적어 주세요." };

  // 🔴 예외가 나도 운영자 기록은 남긴다(검수 중간 5) — KIS 취소는 이미 됐는데 뒤에서 오류가 나면, 기록 없이 "실패"만 보여
  //    운영자가 다시 시도하거나 상점관리자에서 또 처리하려 할 수 있다. 주문 상태는 [결제] 목록에서 확인하게 안내한다.
  let r: Awaited<ReturnType<typeof operatorCancelOrder>>;
  try {
    r = await operatorCancelOrder({ orderId, companyId, reason, stopAutoPay, operator: { name: me.name, email: me.email } });
  } catch (e) {
    console.error(`[operator-billing] 운영자 취소 처리 오류 — 주문 ${orderId.slice(0, 8)}:`, e instanceof Error ? e.message : String(e));
    r = {
      ok: false,
      message: "처리 중 오류가 났습니다. 취소 요청이 이미 KIS로 나갔을 수 있으니, 다시 누르지 말고 [결제] 목록에서 이 결제의 상태를 먼저 확인해 주세요.",
    };
  }
  await logOperatorBilling(
    me, r.ok,
    `operator_payment_cancel:${r.companyName ?? `ID ${companyId.slice(0, 8)}`} (${r.orderNo ?? orderId.slice(0, 8)} · ${r.amount !== undefined ? `${r.amount}원` : "-"} · 자동결제 해지 ${stopAutoPay ? "예" : "아니오"} · ${r.ok ? "요청함" : "거절"}) 사유: ${reason.replace(/\s+/g, " ").trim().slice(0, 100)}`,
  );
  revalidatePath("/operator/payments");
  revalidatePath(`/operator/companies/${companyId}`);
  return { ok: r.ok, message: r.message };
}

/**
 * [결제] 확인 필요 칸의 처리 버튼(6-3) — op 하나로 나눈다.
 *  recheck(KIS에 다시 조회) · close_no_payment / close_refunded / close_restore_paid(KIS 상점관리자에서 확인한 대로 닫기, 사유 필수) ·
 *  ack_revert(직접 처리함, 사유 필수) · refund_mark(카드 등록 중 승인 건 — KIS에서 환불함 표시)
 */
export async function attentionAction(_prev: OperatorBillingResult, formData: FormData): Promise<OperatorBillingResult> {
  const me = await getCurrentOperator();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };
  const op = String(formData.get("op") ?? "");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!ID_RE.test(id)) return { ok: false, message: "요청이 올바르지 않습니다." };
  if (reason.length > 300) return { ok: false, message: "사유는 100자 안으로 적어 주세요." };

  let r: OpResult;
  try {
    if (op === "recheck") r = await operatorRecheckOrder(id);
    else if (op === "close_no_payment") r = await operatorCloseOrder(id, "no_payment", reason);
    else if (op === "close_refunded") r = await operatorCloseOrder(id, "refunded", reason);
    else if (op === "close_restore_paid") r = await operatorCloseOrder(id, "restore_paid", reason);
    else if (op === "ack_revert") r = await operatorAckRevert(id, reason);
    else if (op === "refund_mark") r = await markRegChargeRefunded(id, { name: me.name, email: me.email });
    else return { ok: false, message: "요청이 올바르지 않습니다." };
  } catch (e) {
    // KIS 통신 오류 등 — 원문은 서버 기록에만(화면에는 짧게).
    console.error(`[operator-billing] 확인 필요 처리 오류(${op}):`, e instanceof Error ? e.message : String(e));
    r = { ok: false, message: "처리 중 오류가 났습니다. 잠시 뒤 다시 해 주세요.", meta: "오류" };
  }
  await logOperatorBilling(me, r.ok, `operator_payment_${op}:${r.meta}`);
  revalidatePath("/operator/payments");
  return { ok: r.ok, message: r.message };
}
