// 운영자 회사 상세 — "결제" 칸(2026-11-23 결제 6단계). 서버 컴포넌트(표시만).
//  · 이용 상태(무료 끝·낸 기간 끝·막히는 날) · 요금 인원(관리자 1명 제외) · 자동결제 카드 · 결제 내역 · [취소(환불)].
//  · 취소 버튼은 이 회사 이용 기간 **맨 끝에 붙은 결제 하나**에만 나온다(lib/billing-operator.ts getCompanyBilling).
import { KEY_STATUS_LABEL, type CompanyBilling } from "@/lib/billing-operator";
import { ymd, lastDayOf, won, th, td, StatusBadge, typeLabel, ymdhm } from "../../payments/PayParts";
import { CancelPaymentForm, type CancelTarget } from "./CancelPaymentForm";

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" };

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #F3F4F6", fontSize: 14 }}>
      <div style={{ width: 130, flexShrink: 0, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ minWidth: 0, wordBreak: "keep-all", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

/** 미납 차단 판정을 한 줄로. */
function accessText(b: CompanyBilling): { text: string; danger: boolean } {
  const a = b.access;
  if (!a) return { text: "—", danger: false };
  switch (a.kind) {
    case "demo":
      return { text: "시험용 회사 — 막지 않음", danger: false };
    case "unknown":
      return { text: "판단할 수 없음(날짜 값 확인 필요) — 막지 않음", danger: true };
    case "ok":
      return { text: a.enforced ? "정상 이용 중" : "정상 이용 중 · 미납 차단은 아직 꺼져 있음", danger: false };
    case "ending":
      return { text: `곧 끝남(${a.daysLeft}일 남음)${a.blockAt ? ` · 결제가 없으면 ${ymd(a.blockAt)}부터 직원 새 출근이 막힘` : " · 미납 차단 꺼짐"}`, danger: false };
    case "grace":
      if (a.hold === "payment_pending") return { text: "이용 기간 끝남 · 확인 중인 결제가 있어 막지 않음", danger: true };
      if (a.hold === "card_unavailable") return { text: "이용 기간 끝남 · 카드로 낼 수 없는 규모라 막지 않음(따로 안내 필요)", danger: true };
      if (a.hold === "nothing_to_pay") return { text: "이용 기간 끝남 · 요금 대상 인원이 없어 막지 않음", danger: false };
      return { text: a.blockAt ? `이용 기간 끝남 · 유예 중 — ${ymd(a.blockAt)}부터 직원 새 출근이 막힘` : "이용 기간 끝남 · 미납 차단 꺼짐(막지 않음)", danger: true };
    case "blocked":
      return { text: `막힘 — ${ymd(a.blockAt)}부터 직원의 새 출근·외출 시작이 막혀 있음`, danger: true };
  }
}

export function CompanyBillingSection({ companyId, b }: { companyId: string; b: CompanyBilling }) {
  const acc = accessText(b);
  const last = b.cancellableOrderId ? b.orders.find((o) => o.id === b.cancellableOrderId) : undefined;
  const target: CancelTarget | null = last && b.cancelPreview
    ? {
        orderId: last.id,
        label: `${ymd(last.paidAt ?? last.createdAt)} ${typeLabel(last.orderType)} ${won(b.cancelPreview.amount)}`,
        amountText: won(b.cancelPreview.amount),
        revertText: b.cancelPreview.revertTo ? `${lastDayOf(b.cancelPreview.revertTo)}까지` : "결제 전 상태(무료 기간만)",
        autoPayOrder: b.cancelPreview.autoPayOrder,
      }
    : null;
  return (
    <section style={{ ...card, marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>결제</h2>
      <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "0 0 10px", lineHeight: 1.6, wordBreak: "keep-all" }}>
        카드번호는 가린 값만 보입니다. 취소(환불)는 이 회사 이용 기간 맨 끝에 붙은 결제부터 하나씩만 할 수 있습니다(가운데 결제를 빼면 기간이 꼬입니다).
      </p>
      <Line label="무료 이용">{lastDayOf(b.trialEnd)}까지</Line>
      <Line label="결제한 이용 기간">{b.paidUntil ? `${lastDayOf(b.paidUntil)}까지` : "결제 없음"}</Line>
      <Line label="이용 상태">
        <span style={{ color: acc.danger ? "var(--danger)" : undefined, fontWeight: acc.danger ? 700 : undefined }}>{acc.text}</span>
      </Line>
      <Line label="요금 인원">
        <b>{b.heads.billable}명</b>
        <span style={{ color: "var(--text-sub)" }}> (재직 직원 {b.heads.employees}명 + 관리자 {b.heads.admins}명 중 1명 제외) · {b.quoteText}</span>
      </Line>
      <Line label="자동결제">
        {b.card ? (
          <>
            {KEY_STATUS_LABEL[b.card.status] ?? b.card.status}
            {b.card.card && <span style={{ color: "var(--text-sub)" }}> · {b.card.card}</span>}
            {b.card.status === "active" && b.card.nextChargeDate && <span> · 다음 결제일 {ymd(b.card.nextChargeDate)}</span>}
            {b.card.failCount > 0 && <span style={{ color: "var(--danger)", fontWeight: 700 }}> · 연속 실패 {b.card.failCount}번</span>}
            {b.card.lastFailReason && <div style={{ fontSize: 13, color: "var(--text-sub)" }}>{b.card.lastFailReason}</div>}
          </>
        ) : (
          <span style={{ color: "var(--text-sub)" }}>신청 안 함</span>
        )}
      </Line>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "18px 0 8px" }}>결제 내역(최근 20건)</h3>
      {b.cancelBlockedReason && (
        <div role="status" style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#9A3412", marginBottom: 10, wordBreak: "keep-all" }}>
          {b.cancelBlockedReason}
        </div>
      )}
      <CancelPaymentForm companyId={companyId} target={target} hasLiveCard={b.hasLiveCard} />
      {b.orders.length === 0 ? (
        <div style={{ fontSize: 14, color: "var(--text-sub)", padding: "8px 0" }}>아직 결제가 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>결제 시각</th>
                <th style={th}>종류</th>
                <th style={{ ...th, textAlign: "right" }}>금액</th>
                <th style={th}>상태</th>
                <th style={th}>늘어난 이용 기간</th>
                <th style={th}>카드 · 거래번호</th>
              </tr>
            </thead>
            <tbody>
              {b.orders.map((o) => (
                <tr key={o.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymdhm(o.paidAt ?? o.createdAt)}</td>
                  <td style={td}>{typeLabel(o.orderType)}<div style={{ fontSize: 12, color: "var(--text-sub)" }}>{o.employees}명 기준</div></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{won(o.totalAmount)}</td>
                  <td style={{ ...td, whiteSpace: "normal", maxWidth: 260 }}>
                    <StatusBadge status={o.status} />
                    {o.operatorCancelAt && (
                      <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4, wordBreak: "keep-all" }}>
                        운영자 취소 {ymdhm(o.operatorCancelAt)} · {o.operatorCancelBy}
                      </div>
                    )}
                    {o.failReason && o.status !== "paid" && <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4, wordBreak: "keep-all" }}>{o.failReason}</div>}
                  </td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                    {o.periodStart && o.periodEnd ? `${ymd(o.periodStart)} ~ ${lastDayOf(o.periodEnd)}` : "—"}
                    {o.status === "cancelled" && o.paidAt && (
                      <div style={{ fontSize: 12, color: o.periodRevertedAt ? "var(--text-sub)" : "var(--danger)", fontWeight: o.periodRevertedAt ? 400 : 700 }}>
                        {o.periodRevertedAt ? "기간 되돌림" : "기간 되돌리는 중"}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 13 }}>
                    {o.id === b.cancellableOrderId && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>취소 가능(맨 끝 결제)</div>}
                    {o.card ?? "—"}
                    <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{o.tidTail ?? ""}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
