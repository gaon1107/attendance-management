"use server";
// [구독 결제] 화면의 결제 버튼들 — 2026-11-23 결제 2단계(카드 1개월 결제) · 3단계(자동결제 신청·해지).
//  · 관리자(회사 계정 포함)만. 금액·인원은 서버가 계산한다(화면이 보낸 값을 받지 않는다 — 받을 칸도 없다).
//  · 돌려주는 fields에는 상점키가 없다(암호값 encData만). 상점키는 서버 밖으로 나가지 않는다.
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { createPayOrder, type CreateOrderResult } from "@/lib/billing-pay";
import { startCardRegistration, cancelAutoPay as cancelAutoPayLib, approveCurrentTier as approveCurrentTierLib, type StartRegResult } from "@/lib/billing-auto";

export async function startCardPayment(): Promise<CreateOrderResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "로그인이 풀렸습니다. 다시 로그인해 주세요." };
  if (me.role !== "admin") return { ok: false, error: "관리자만 결제할 수 있습니다." };
  try {
    return await createPayOrder({ companyId: me.companyId, userId: me.id });
  } catch (e) {
    console.error("[billing] 결제 주문 만들기 실패:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** [자동결제 신청] — 동의 체크(consent)를 서버가 다시 확인한다. 금액은 서버가 그 순간 인원으로 정한다. */
export async function startAutoPayRegistration(consent: boolean): Promise<StartRegResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "로그인이 풀렸습니다. 다시 로그인해 주세요." };
  if (me.role !== "admin") return { ok: false, error: "관리자만 자동결제를 신청할 수 있습니다." };
  try {
    return await startCardRegistration({ companyId: me.companyId, userId: me.id, consent: consent === true });
  } catch (e) {
    console.error("[billing] 자동결제 신청 시작 실패:", e instanceof Error ? e.name : "unknown");
    return { ok: false, error: "자동결제 신청을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** [자동결제 해지] — 카드만 지운다. 이미 결제한 기간은 끝까지 쓴다. */
export async function cancelAutoPay(): Promise<{ ok: boolean; message: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };
  if (me.role !== "admin") return { ok: false, message: "관리자만 자동결제를 해지할 수 있습니다." };
  try {
    const r = await cancelAutoPayLib(me.companyId);
    revalidatePath("/subscription");
    return r;
  } catch (e) {
    console.error("[billing] 자동결제 해지 실패:", e instanceof Error ? e.name : "unknown");
    return { ok: false, message: "해지하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** [새 금액에 동의] — 화면에서 본 구간(seenTierIndex)이 지금 구간과 같을 때만 동의한다. */
export async function approveAutoPayTier(seenTierIndex: number): Promise<{ ok: boolean; message: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };
  if (me.role !== "admin") return { ok: false, message: "관리자만 동의할 수 있습니다." };
  try {
    const r = await approveCurrentTierLib(me.companyId, Number(seenTierIndex));
    revalidatePath("/subscription");
    return r;
  } catch (e) {
    console.error("[billing] 새 금액 동의 실패:", e instanceof Error ? e.name : "unknown");
    return { ok: false, message: "동의를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
