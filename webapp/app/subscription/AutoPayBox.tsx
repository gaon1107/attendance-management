"use client";
// [구독·요금] 자동결제 칸 — 2026-11-23 결제 3단계(lib/billing-auto.ts).
//  · 신청: 안내를 읽고 **따로 체크**해야 [카드 등록하기]가 켜진다(일괄 동의 금지 — 2025-02 시행 개정 전자상거래법 제13조 ⑥ 취지).
//    서버도 체크 값을 다시 확인한다. 금액·날짜는 전부 서버가 계산해 넘긴 값이다(이 화면은 계산하지 않는다 — 설명 글은 코드로 검증).
//  · 카드 등록 창은 돈을 빼지 않는다. 결제일이 이미 지났으면 등록 직후 서버가 바로 첫 결제를 한다 — 그 사실을 안내문에 적는다.
//  · 결과 안내는 화면으로만(사장님 11-23 — 문자 없음): 실패·멈춤은 이 칸과 관리자 알림센터에 보인다.
import { useEffect, useRef, useState } from "react";
import { startAutoPayRegistration, cancelAutoPay, approveAutoPayTier } from "@/app/actions/billing";
import { Modal } from "@/app/components/Modal";
import { openKisFrame } from "./kis-frame";

export type AutoPayView = {
  ready: boolean;
  state: "none" | "active" | "paused" | "reg_checking";
  deleting: boolean;
  card: { cardName: string | null; cardNoMasked: string | null; nextChargeText: string | null; failCount: number; lastFailReason: string | null } | null;
  /** 신청 안내에 쓸 값 — 지금 인원 기준. null이면 신청할 금액이 없다(noAmountReason). */
  offer: { tierIndex: number; label: string; monthlyText: string; vatText: string; totalText: string; firstChargeText: string; chargeNow: boolean; startText: string } | null;
  noAmountReason: string | null;
  /** 사용 중 카드의 다음 결제 예상 — 동의 구간에 막혀 지금 구간보다 낮게 청구되면 capped */
  next: { totalText: string; label: string; capped: boolean; currentTotalText: string | null; currentLabel: string | null; currentTierIndex: number | null } | null;
};

const btn = {
  height: 40, padding: "0 18px", border: 0, borderRadius: 8, background: "var(--primary)", color: "#fff",
  fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
} as const;
const btnGhost = { ...btn, background: "#fff", color: "var(--text)", border: "1px solid var(--border)" } as const;
const note = { fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7, wordBreak: "keep-all" as const };

export function AutoPayBox({ v }: { v: AutoPayView }) {
  const [showForm, setShowForm] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  async function register() {
    setError(null);
    setInfo(null);
    if (!consent) {
      setError("안내를 확인하고 동의에 체크해 주세요.");
      return;
    }
    setBusy(true);
    let r: Awaited<ReturnType<typeof startAutoPayRegistration>>;
    try {
      // 체크한 금액의 구간을 함께 보낸다 — 그사이 인원이 바뀌었으면 서버가 거절한다(검수 중간 1).
      r = await startAutoPayRegistration(true, v.offer?.tierIndex ?? -1);
    } catch {
      setBusy(false);
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    try {
      cleanupRef.current?.();
      cleanupRef.current = openKisFrame(r.action, r.fields, r.regNo, {
        title: "카드 등록 창",
        closeLabel: "카드 등록 창 닫기",
        notDoneText: "카드 등록이 진행되지 않았습니다.",
        onClosed: (notice) => {
          cleanupRef.current = null;
          setBusy(false);
          if (notice) setError(notice);
        },
        onPostFail: () => {
          cleanupRef.current = null;
          setBusy(false);
          setError("카드 등록 결과를 받는 중 문제가 생겼습니다. 잠시 뒤 이 화면을 새로 고쳐 확인해 주세요.");
        },
      });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "카드 등록 창을 열 수 없습니다.");
    }
  }

  async function doCancel() {
    setBusy(true);
    setError(null);
    try {
      const r = await cancelAutoPay();
      if (r.ok) setInfo(r.message);
      else setError(r.message);
    } catch {
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    setBusy(false);
    setConfirmCancel(false);
  }

  async function approveTier() {
    if (v.next?.currentTierIndex === null || v.next?.currentTierIndex === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const r = await approveAutoPayTier(v.next.currentTierIndex);
      if (r.ok) setInfo(r.message);
      else setError(r.message);
    } catch {
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    setBusy(false);
  }

  const messages = (
    <>
      {error ? <div role="alert" style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: "var(--danger)", wordBreak: "keep-all" }}>{error}</div> : null}
      {info ? <div role="status" style={{ marginTop: 10, fontSize: 14, fontWeight: 700, color: "var(--success, #15803D)", wordBreak: "keep-all" }}>{info}</div> : null}
    </>
  );

  // 신청(또는 카드 바꾸기·다시 등록) 안내 + 동의 체크 + [카드 등록하기]
  const form = v.offer ? (
    <div style={{ marginTop: 12, padding: "14px 16px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>자동결제 안내</div>
      <ul style={{ ...note, margin: "0 0 12px", paddingLeft: 18, color: "var(--text)" }}>
        <li>
          매달 <strong>월 {v.offer.totalText}</strong>(부가세 포함 — 공급가 {v.offer.monthlyText} + 부가세 {v.offer.vatText}, 지금 {v.offer.label} 구간)이
          등록하신 카드에서 일시불로 결제됩니다.
        </li>
        <li>
          {v.offer.chargeNow ? (
            <>이용 기간이 끝났거나 곧 끝나므로 <strong>카드를 등록하시면 바로 첫 결제</strong>가 되고, 이용 기간 1개월이 {v.offer.startText}부터 시작됩니다.</>
          ) : (
            <>첫 결제일은 <strong>{v.offer.firstChargeText}</strong>(오전 10시 이후)이고, 유료 1개월은 {v.offer.startText}부터 시작됩니다.</>
          )}{" "}
          그다음부터는 매달 이용 기간이 끝나기 3일 전에 결제됩니다.
        </li>
        <li>
          요금은 결제일의 인원으로 정합니다. 인원이 줄면 낮은 요금으로 결제되고, 늘어서 요금이 오르면 새 금액에 따로 동의하시기 전까지는 이 금액을 넘지 않습니다.
          요금표가 바뀌어 이 금액보다 많아지면 결제하지 않고 자동결제를 멈춘 뒤 다시 동의를 받습니다. 인원이 요금표를 넘으면(별도 협의 규모) 자동결제를 멈춥니다.
        </li>
        <li>결제가 안 되면 다음 날 오전 10시 이후에 다시 시도하고, 3번 실패하면 자동결제를 멈춥니다(이 화면과 알림에 표시).</li>
        <li>해지는 이 화면에서 언제든 할 수 있습니다. 이미 결제한 이용 기간은 환불되지 않으며 끝까지 쓰실 수 있습니다.</li>
        <li>카드 등록 창에서는 돈이 빠지지 않습니다{v.offer.chargeNow ? "(첫 결제는 등록이 끝난 직후에 따로 됩니다)" : ""}.</li>
      </ul>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, fontWeight: 700, cursor: "pointer", wordBreak: "keep-all" }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16 }} />
        위 내용을 확인했으며, 매달 월 {v.offer.totalText}(부가세 포함)의 자동결제에 동의합니다.
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" onClick={register} disabled={busy || !consent} style={{ ...btn, opacity: busy || !consent ? 0.5 : 1, cursor: busy || !consent ? "default" : "pointer" }}>
          {busy ? "카드 등록 창 여는 중…" : "카드 등록하기"}
        </button>
        <button type="button" onClick={() => { setShowForm(false); setConsent(false); setError(null); }} disabled={busy} style={btnGhost}>
          닫기
        </button>
      </div>
    </div>
  ) : (
    <p style={{ ...note, margin: "10px 0 0" }}>{v.noAmountReason ?? "지금은 자동결제를 신청할 금액이 없습니다."}</p>
  );

  if (!v.ready) {
    return (
      <p style={{ ...note, margin: 0 }}>
        <strong>자동결제를 준비 중입니다.</strong> 결제사 심사가 끝나면 이 자리에서 카드를 등록해 매달 자동으로 결제하실 수 있습니다.
      </p>
    );
  }

  if (v.state === "reg_checking") {
    return (
      <p style={{ ...note, margin: 0 }}>
        <strong>카드 등록 결과를 확인하고 있습니다.</strong> 카드사 확인에 1시간쯤 걸립니다. 그동안 다시 신청하지 마세요. 하루가 지나도 이대로면 고객센터로 연락해 주세요.
      </p>
    );
  }

  const cardLine = v.card ? (
    <div style={{ fontSize: 14, fontWeight: 700, wordBreak: "keep-all" }}>
      {v.card.cardName ?? "등록 카드"}
      {v.card.cardNoMasked ? <span style={{ color: "var(--text-sub)", fontWeight: 400 }}> {v.card.cardNoMasked}</span> : null}
    </div>
  ) : null;

  const cancelModal = (
    <Modal open={confirmCancel} onClose={() => (busy ? undefined : setConfirmCancel(false))} title="자동결제 해지" maxWidth={420}>
      <p style={{ ...note, color: "var(--text)", fontSize: 14, margin: "0 0 16px" }}>
        해지하면 등록한 카드를 지우고 더는 자동으로 결제하지 않습니다. 이미 결제한 이용 기간은 끝까지 쓰실 수 있고 환불되지 않습니다.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => setConfirmCancel(false)} disabled={busy} style={btnGhost}>취소</button>
        <button type="button" onClick={doCancel} disabled={busy} style={{ ...btn, background: "var(--danger)", opacity: busy ? 0.6 : 1 }}>
          {busy ? "해지하는 중…" : "자동결제 해지"}
        </button>
      </div>
    </Modal>
  );

  if (v.state === "active" || v.state === "paused") {
    return (
      <div>
        {cardLine}
        {v.state === "paused" ? (
          <div style={{ marginTop: 8, padding: "10px 14px", borderLeft: "4px solid var(--danger)", background: "#FEF2F2", borderRadius: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)", marginBottom: 4 }}>자동결제가 멈췄습니다</div>
            <p style={{ ...note, margin: 0, color: "var(--text)" }}>
              {v.card?.lastFailReason ?? "자동결제가 더 이상 진행되지 않습니다."} 카드를 다시 등록하시거나 위 [결제]에서 직접 결제해 주세요.
            </p>
          </div>
        ) : (
          <p style={{ ...note, margin: "6px 0 0" }}>
            다음 자동 결제일은 <strong>{v.card?.nextChargeText ?? "—"}</strong>(오전 10시 이후)
            {v.next ? <>, 예상 금액은 <strong>월 {v.next.totalText}</strong>(부가세 포함, {v.next.label} 구간)</> : null}입니다.
          </p>
        )}
        {v.state === "active" && v.card && v.card.failCount > 0 ? (
          <div style={{ marginTop: 8, padding: "10px 14px", borderLeft: "4px solid var(--warning)", background: "#FFFBEB", borderRadius: 6 }}>
            <p style={{ ...note, margin: 0, color: "var(--text)" }}>
              <strong>결제가 {v.card.failCount}번 승인되지 않았습니다.</strong> {v.card.lastFailReason ? `(${v.card.lastFailReason}) ` : ""}
              다음 날 오전 10시 이후에 다시 시도하며, 3번 실패하면 자동결제를 멈춥니다. 카드 한도·유효기간을 확인하시거나 카드를 바꿔 주세요.
            </p>
          </div>
        ) : null}
        {v.state === "active" && v.next?.capped && v.next.currentTotalText ? (
          <div style={{ marginTop: 8, padding: "10px 14px", borderLeft: "4px solid var(--primary)", background: "#EFF6FF", borderRadius: 6 }}>
            <p style={{ ...note, margin: "0 0 8px", color: "var(--text)" }}>
              인원이 늘어 지금 요금은 <strong>월 {v.next.currentTotalText}</strong>({v.next.currentLabel} 구간, 부가세 포함)입니다.
              새 금액에 동의하시기 전까지는 동의하신 <strong>월 {v.next.totalText}</strong>로 결제됩니다.
            </p>
            <button type="button" onClick={approveTier} disabled={busy} style={{ ...btn, height: 36, opacity: busy ? 0.6 : 1 }}>
              월 {v.next.currentTotalText}에 동의하기
            </button>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {!showForm ? (
            <button type="button" onClick={() => { setShowForm(true); setError(null); setInfo(null); }} disabled={busy} style={v.state === "paused" ? btn : btnGhost}>
              {v.state === "paused" ? "카드 다시 등록하기" : "카드 바꾸기"}
            </button>
          ) : null}
          <button type="button" onClick={() => setConfirmCancel(true)} disabled={busy} style={{ ...btnGhost, color: "var(--danger)" }}>
            자동결제 해지
          </button>
        </div>
        {showForm ? (
          <>
            <p style={{ ...note, margin: "10px 0 0" }}>새 카드 등록이 끝나면 지금 카드는 자동으로 지워집니다.</p>
            {form}
          </>
        ) : null}
        {messages}
        {cancelModal}
      </div>
    );
  }

  // 신청 전
  return (
    <div>
      <p style={{ ...note, margin: 0 }}>
        카드를 한 번 등록해 두시면 매달 이용 기간이 끝나기 3일 전에 자동으로 결제되어, 결제를 잊는 일을 막을 수 있습니다.
        신청하실 때만 시작되며 언제든 해지하실 수 있습니다.
      </p>
      {v.deleting ? <p style={{ ...note, margin: "6px 0 0" }}>이전에 등록한 카드를 지우는 중입니다.</p> : null}
      {!showForm ? (
        <button type="button" onClick={() => { setShowForm(true); setError(null); setInfo(null); }} style={{ ...btn, marginTop: 12 }}>
          자동결제 신청하기
        </button>
      ) : (
        form
      )}
      {messages}
    </div>
  );
}
