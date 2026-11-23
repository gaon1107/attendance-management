"use client";
// [결제] 확인 필요 칸의 처리 버튼(2026-11-23 결제 6-3).
//  · 결과 문구는 칸 맨 위 **한 자리**(AttentionProvider)에 보인다 — 처리가 끝나면 그 줄이 목록에서 사라지므로,
//    줄 안에 두면 결과 문구도 같이 사라진다. 그래서 상태(useActionState)를 칸 전체가 같이 쓴다(context).
//  · 실제 판단·검사·기록은 서버(app/actions/operator-billing.ts → lib/billing-operator.ts)가 한다.
import { createContext, useActionState, useContext, useState } from "react";
import { attentionAction, type OperatorBillingResult } from "@/app/actions/operator-billing";
import type { AttentionKind } from "@/lib/billing-operator";

type Ctx = { action: (fd: FormData) => void; pending: boolean };
const AttentionCtx = createContext<Ctx | null>(null);

const btn: React.CSSProperties = {
  height: 34, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
};
const input: React.CSSProperties = {
  width: "100%", height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", background: "#fff", boxSizing: "border-box",
};

export function AttentionProvider({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<OperatorBillingResult, FormData>(attentionAction, null);
  return (
    <AttentionCtx.Provider value={{ action, pending }}>
      {state && (
        <div role={state.ok ? "status" : "alert"} style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, wordBreak: "keep-all", background: state.ok ? "#F0FDF4" : "#FEF2F2", color: state.ok ? "var(--success)" : "var(--danger)" }}>
          {state.message}
        </div>
      )}
      {children}
    </AttentionCtx.Provider>
  );
}

function useAttention(): Ctx {
  const c = useContext(AttentionCtx);
  if (!c) throw new Error("AttentionProvider 안에서만 쓸 수 있습니다");
  return c;
}

/** 확인 중·취소 중·기간 못 되돌림 결제 한 줄의 버튼. */
export function OrderAttentionActions({ orderId, status, kinds, wasPaid }: { orderId: string; status: string; kinds: AttentionKind[]; wasPaid: boolean }) {
  const { action, pending } = useAttention();
  const [open, setOpen] = useState(false);
  const notReverted = status === "cancelled" && kinds.includes("not_reverted");
  // 닫기 결과는 **운영자가 직접 고른다**(미리 골라 두지 않음 — 검수 중간 3: '결제 없음'이 기본이면 돈이 빠진 결제를 실패로 닫기 쉽다).
  //  · '결제 없음'은 확인 중이면서 KIS 승인이 확인되지 않은 건만(반영 재시도 중 = 승인 확인됨 → 숨김, 서버도 거절).
  //  · '결제 완료로 되돌리기'는 운영자가 취소를 요청한 결제 완료 건이 취소 중일 때만(KIS가 취소를 거절한 경우 — 검수 중간 2).
  type Outcome = "close_no_payment" | "close_refunded" | "close_restore_paid" | "ack_revert";
  const [outcome, setOutcome] = useState<Outcome | null>(notReverted ? "ack_revert" : null);
  const canNoPayment = status === "check" && !kinds.includes("apply_retry");
  const canRestore = status === "cancel_check" && wasPaid;
  const [reason, setReason] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", flex: "0 1 320px" }}>
      <form action={action} style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <input type="hidden" name="op" value="recheck" />
        <input type="hidden" name="id" value={orderId} />
        <button type="submit" disabled={pending} style={{ ...btn, border: 0, background: "var(--primary)", color: "#fff", opacity: pending ? 0.6 : 1 }}>
          {notReverted ? "기간 다시 되돌리기" : "KIS에 다시 조회"}
        </button>
        <button type="button" onClick={() => { setOpen((v) => !v); setReason(""); }} disabled={pending} style={{ ...btn, background: "#fff", border: "1px solid var(--border)", color: "var(--text)" }}>
          {notReverted ? "직접 처리함" : "확인한 대로 닫기"}
        </button>
      </form>
      {open && (
        <form action={action} style={{ width: "100%", background: "#F9FAFB", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
          <input type="hidden" name="id" value={orderId} />
          <input type="hidden" name="op" value={outcome ?? ""} />
          {notReverted ? (
            <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8, wordBreak: "keep-all" }}>
              이 결제는 취소됐지만 뒤에 다른 결제가 있어 이용 기간을 자동으로 되돌리지 못했습니다. 고객과 상의해 처리했다면 어떻게 했는지 적어 주세요(목록에서 빠집니다).
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8, wordBreak: "keep-all" }}>
              <b>KIS 상점관리자에서 이 거래를 직접 확인한 뒤에만</b> 쓰세요. 확인한 결과:
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {canNoPayment && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" checked={outcome === "close_no_payment"} onChange={() => setOutcome("close_no_payment")} />
                    결제 없음(돈이 빠지지 않음) → 실패로 닫기
                  </label>
                )}
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="radio" checked={outcome === "close_refunded"} onChange={() => setOutcome("close_refunded")} />
                  취소(환불)됨 → 취소로 닫기{wasPaid ? "(이 결제로 늘어난 기간도 되돌림)" : ""}
                </label>
                {canRestore && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" checked={outcome === "close_restore_paid"} onChange={() => setOutcome("close_restore_paid")} />
                    취소 안 됨(돈이 그대로 있음) → 결제 완료로 되돌리기
                  </label>
                )}
              </div>
            </div>
          )}
          <input name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} placeholder="확인한 내용(필수) 예: 상점관리자 조회 — 거래 없음" style={input} />
          <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
            <button type="submit" disabled={pending || !outcome || reason.trim().length < 2} style={{ ...btn, border: 0, background: "var(--danger)", color: "#fff", opacity: pending || !outcome || reason.trim().length < 2 ? 0.5 : 1 }}>
              이대로 닫기
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** 카드 등록 중 결제가 승인된 건 — KIS 상점관리자에서 취소한 뒤 표시만. */
export function CardRefundMark({ keyId }: { keyId: string }) {
  const { action, pending } = useAttention();
  const [checked, setChecked] = useState(false);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flex: "0 1 320px" }}>
      <input type="hidden" name="op" value="refund_mark" />
      <input type="hidden" name="id" value={keyId} />
      <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5, wordBreak: "keep-all" }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 3 }} />
        KIS 상점관리자에서 이 거래를 취소(환불)했습니다
      </label>
      <button type="submit" disabled={pending || !checked} style={{ ...btn, border: 0, background: "var(--primary)", color: "#fff", opacity: pending || !checked ? 0.5 : 1 }}>
        KIS에서 환불함 표시
      </button>
    </form>
  );
}
