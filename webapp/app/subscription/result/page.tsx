// [결제 결과] KIS 결제창 → 결과 받기(/api/billing/return) 뒤에 오는 화면 — 2026-11-23 결제 2단계.
//  · 자기 회사 주문만 보인다(다른 회사 주문번호를 넣어도 "찾을 수 없음").
//  · DB 상태를 그대로 보여 줄 뿐 아무것도 바꾸지 않는다. 결과 모름(check)이면 10분 정리가 닫으니 잠시 뒤 다시 보라고 안내한다.
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { orderForCompany } from "@/lib/billing-pay";
import { formatWon } from "@/lib/pricing";
import { formatKoreanDate, trialLastDay } from "@/lib/trial";

export const dynamic = "force-dynamic";

type SP = Promise<{ orderNo?: string }>;

export default async function PayResultPage({ searchParams }: { searchParams: SP }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");
  const sp = await searchParams;
  const orderNo = typeof sp.orderNo === "string" ? sp.orderNo.slice(0, 40) : "";
  const o = orderNo ? await orderForCompany(me.companyId, orderNo) : null;

  const box = { background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "24px 24px", maxWidth: 560 };
  const tone =
    o?.status === "paid" ? { color: "var(--success, #15803D)", title: "결제가 완료되었습니다" }
    : o?.status === "check" || o?.status === "cancel_check" ? { color: "var(--warning)", title: "결제를 확인하고 있습니다" }
    : o?.status === "cancelled" ? { color: "var(--text-sub)", title: "결제가 취소되었습니다" }
    // ready = 승인 요청을 아직 보내지 않은 상태(같은 결과가 동시에 두 번 왔거나 다른 결제가 처리 중). 실패로 단정하지 않는다.
    : o?.status === "ready" ? { color: "var(--warning)", title: "결제가 아직 처리되지 않았습니다" }
    : { color: "var(--danger)", title: o ? "결제가 완료되지 않았습니다" : "결제 정보를 찾을 수 없습니다" };

  return (
    <AppShell user={me} active="subscription" title="결제 결과" subtitle={me.company.name}>
      <div style={box}>
        <div style={{ fontSize: 20, fontWeight: 700, color: tone.color, marginBottom: 14 }}>{tone.title}</div>
        {o ? (
          <div style={{ fontSize: 14, lineHeight: 1.9, wordBreak: "keep-all" }}>
            <div>{o.productName}</div>
            <div>
              금액 <strong>{formatWon(o.totalAmount)}</strong> (부가세 포함)
              {o.cardName ? <span style={{ color: "var(--text-sub)" }}> · {o.cardName}{o.cardNoMasked ? ` ${o.cardNoMasked}` : ""}</span> : null}
            </div>
            {o.status === "paid" && o.periodStart && o.periodEnd ? (
              <div>
                이용 기간 <strong>{formatKoreanDate(o.periodStart)} ~ {formatKoreanDate(trialLastDay(o.periodEnd))}</strong>
              </div>
            ) : null}
            {o.status === "check" || o.status === "cancel_check" ? (
              <p style={{ color: "var(--text-sub)", margin: "8px 0 0" }}>
                {o.status === "cancel_check" ? "결제를 자동으로 취소(환불)하는 중입니다." : "카드사 응답을 확인하는 중입니다."}{" "}
                보통 10분 안에, 길게는 1시간쯤 뒤 [구독·요금]의 결제 내역에 결과가 나옵니다. 두 번 결제하지 않도록 그동안 다시 결제하지 마세요.
              </p>
            ) : null}
            {o.status === "ready" ? (
              <p style={{ color: "var(--text-sub)", margin: "8px 0 0" }}>
                결제가 처리 중이거나 완료되지 않았습니다. 잠시 뒤 [구독·요금]의 결제 내역을 확인해 주세요. 내역에 없으면 카드에서 돈이 빠지지 않은 것입니다.
              </p>
            ) : null}
            {o.status === "failed" ? (
              <p style={{ color: "var(--text-sub)", margin: "8px 0 0" }}>
                카드에서 돈이 빠져나가지 않았습니다.{o.pgResultMsg ? ` (${o.pgResultMsg})` : ""} 다시 시도해 주세요.
              </p>
            ) : null}
            {o.status === "cancelled" ? (
              <p style={{ color: "var(--text-sub)", margin: "8px 0 0" }}>
                결제가 자동으로 취소되었습니다. 카드사에 따라 취소가 반영되기까지 며칠 걸릴 수 있습니다.
              </p>
            ) : null}
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 10 }}>주문번호 {o.orderNo}</div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--text-sub)", margin: 0, lineHeight: 1.7, wordBreak: "keep-all" }}>
            결제창에서 돌아온 정보로 주문을 찾지 못했습니다. [구독·요금]의 결제 내역을 확인해 주세요.
          </p>
        )}
        <div style={{ marginTop: 18 }}>
          <Link href="/subscription" style={{ color: "var(--primary)", fontWeight: 700 }}>
            ← 구독·요금으로
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
