"use server";
// 운영자 결제 처리 서버 액션 — 2026-11-23 결제 6단계. 실제 규칙·검사는 lib/billing-operator.ts가 한다(여기는 입력·권한·기록).
//
// 🔴 운영자 로그인은 **여기서 다시** 확인한다(화면을 거치지 않고 직접 불릴 수 있다).
// 🔴 돈이 움직이는 처리라 성공·실패와 상관없이 운영자 기록(접속 기록 config)을 남긴다 — 누가·언제·어느 결제·사유.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentOperator } from "@/lib/operator-session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { operatorCancelOrder } from "@/lib/billing-operator";

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

  const r = await operatorCancelOrder({ orderId, companyId, reason, stopAutoPay, operator: { name: me.name, email: me.email } });
  await logOperatorBilling(
    me, r.ok,
    `operator_payment_cancel:${r.companyName ?? `ID ${companyId.slice(0, 8)}`} (${r.orderNo ?? orderId.slice(0, 8)} · ${r.amount !== undefined ? `${r.amount}원` : "-"} · 자동결제 해지 ${stopAutoPay ? "예" : "아니오"} · ${r.ok ? "요청함" : "거절"}) 사유: ${reason.replace(/\s+/g, " ").trim().slice(0, 100)}`,
  );
  revalidatePath("/operator/payments");
  revalidatePath(`/operator/companies/${companyId}`);
  return { ok: r.ok, message: r.message };
}
