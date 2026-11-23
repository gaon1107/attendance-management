"use server";
// [구독 결제] 화면의 [결제하기] — 주문서를 만들고 KIS 결제창 값을 돌려준다(2026-11-23 결제 2단계).
//  · 관리자(회사 계정 포함)만. 금액·인원은 서버가 계산한다(화면이 보낸 값을 받지 않는다 — 받을 칸도 없다).
//  · 돌려주는 fields에는 상점키가 없다(암호값 encData만). 상점키는 서버 밖으로 나가지 않는다.
import { getCurrentUser } from "@/lib/session";
import { createPayOrder, type CreateOrderResult } from "@/lib/billing-pay";

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
