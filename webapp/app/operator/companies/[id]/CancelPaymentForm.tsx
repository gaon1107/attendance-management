"use client";
// 운영자 [취소(환불)] — 회사 상세 "결제" 칸(2026-11-23 결제 6단계).
//  · 버튼 하나로 끝내지 않는다: 누르면 금액·되돌아갈 이용 기간·사유 칸이 펼쳐지고, [환불 확정]을 눌러야 보낸다.
//  · 실제 검사(맨 끝 결제인지·확인 중 결제·상점 설정)는 서버(lib/billing-operator.ts)가 다시 한다. 여기는 입력만.
//  · 표 위 한 자리에 **늘 그려 둔다**(취소할 결제가 없어도) — 성공하면 화면이 새로 그려져 취소 대상이 사라지는데,
//    표 줄 안에 두면 결과 문구도 같이 사라진다. 같은 자리라 결과 문구(state)가 남는다.
import { useActionState, useState } from "react";
import { cancelPaymentAction, type OperatorBillingResult } from "@/app/actions/operator-billing";

const btn: React.CSSProperties = {
  height: 36, padding: "0 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
};

export type CancelTarget = {
  orderId: string;
  label: string; // "2026-11-21 자동결제 33,000원"
  amountText: string; // "33,000원"
  revertText: string; // "2026-12-31까지" / "결제 전 상태(무료 기간만)"
  autoPayOrder: boolean;
};

export function CancelPaymentForm({ companyId, target, hasLiveCard }: { companyId: string; target: CancelTarget | null; hasLiveCard: boolean }) {
  const [state, action, pending] = useActionState<OperatorBillingResult, FormData>(cancelPaymentAction, null);
  // 🔴 펼친 입력칸은 **그 결제 하나에만** 묶는다(어느 결제를 펼쳤는지 기억). 성공하면 바로 앞 결제가 새 취소 대상이 되는데,
  //    입력칸이 열린 채 사유까지 남아 있으면 [환불 확정]을 한 번 더 눌러 다른 결제까지 환불하게 된다(2026-11-23 화면 시험에서 발견).
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const open = !!target && openFor === target.orderId;
  const setOpen = (v: boolean) => {
    setReason("");
    setOpenFor(v && target ? target.orderId : null);
  };

  // 결과 문구는 늘 같은 자리에 — 성공하면 취소 대상이 바뀌거나 사라져도 문구는 남는다.
  const msg = state && (
    <div role={state.ok ? "status" : "alert"} style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: state.ok ? "var(--success)" : "var(--danger)", wordBreak: "keep-all" }}>
      {state.message}
    </div>
  );
  if (!target || !open) {
    return (
      <div style={{ marginBottom: 10 }}>
        {target && (
          <button type="button" onClick={() => setOpen(true)} style={{ ...btn, background: "#fff", border: "1px solid #FECACA", color: "var(--danger)" }}>
            마지막 결제 취소(환불) — {target.label}
          </button>
        )}
        {msg}
      </div>
    );
  }

  return (
    <form
      action={action}
      style={{ maxWidth: 460, marginBottom: 10, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 14px" }}
    >
      <input type="hidden" name="orderId" value={target.orderId} />
      <input type="hidden" name="companyId" value={companyId} />
      <div style={{ fontSize: 14, fontWeight: 700, color: "#991B1B", marginBottom: 6 }}>{target.amountText} 전액을 카드사에 취소합니다</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)", wordBreak: "keep-all" }}>
        취소가 확정되면 이용 기간이 <b>{target.revertText}</b>로 돌아갑니다. 되돌릴 수 없습니다.
        고객사 관리자 화면(알림센터·구독·요금)에 &lsquo;결제 취소&rsquo;가 표시됩니다.
      </div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 700, margin: "10px 0 4px" }}>취소 사유(필수 · 운영자 기록에 남음)</label>
      <input
        name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} required minLength={2}
        placeholder="예: 고객 요청 — 중복 결제"
        style={{ width: "100%", height: 36, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14, fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}
      />
      {hasLiveCard && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 10, lineHeight: 1.5, wordBreak: "keep-all" }}>
          {/* 카드가 있으면 결제 종류와 상관없이 기본으로 켠다(사장님 결정 2026-11-23 — 직접 결제 환불 포함).
              끄면 되돌린 이용 기간에 맞춰 곧 다시 자동 청구될 수 있다(환불 직후 재청구 민원 방지). */}
          <input type="checkbox" name="stopAutoPay" value="1" defaultChecked style={{ marginTop: 3 }} />
          <span>
            자동결제도 함께 해지
            <span style={{ display: "block", color: "var(--text-sub)" }}>끄면 카드는 남고, 되돌린 이용 기간에 맞춰 곧 다시 자동 결제될 수 있습니다.</span>
          </span>
        </label>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={pending || reason.trim().length < 2} style={{ ...btn, border: 0, background: "var(--danger)", color: "#fff", opacity: pending || reason.trim().length < 2 ? 0.5 : 1 }}>
          {pending ? "취소 요청 중…" : "환불 확정"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} style={{ ...btn, background: "#fff", border: "1px solid var(--border)", color: "var(--text-sub)" }}>
          닫기
        </button>
      </div>
      {msg}
    </form>
  );
}
