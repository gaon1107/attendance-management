"use client";
// 외출 사유 설정 폼(B-6) — 직원 [출퇴근] 화면의 외출 사유 드롭다운 목록을 회사가 편집한다.
//  · 저장 형식은 쉼표 한 줄(사내 네트워크 폼과 같은 방식). 입력하는 대로 아래에 미리보기를 보여준다.
//  · 비워서 저장하면 기본 4종으로 되돌아간다.
import { useActionState, useState } from "react";
import { saveOutingReasons } from "@/app/actions/settings";
import {
  parseOutingReasons,
  normalizeOutingReasons,
  formatOutingReasons,
  DEFAULT_OUTING_REASONS,
  MAX_OUTING_REASONS,
  MAX_REASON_LEN,
} from "@/lib/outing-reasons";

export function OutingReasonForm({ initialReasons }: { initialReasons: string }) {
  const [state, formAction, pending] = useActionState(saveOutingReasons, {});
  const [reasons, setReasons] = useState(initialReasons);

  // 저장에 성공하면 입력칸을 "실제 저장된 값"으로 맞춘다(중복·초과 항목이 빠진 결과가 화면과 어긋나지 않게).
  //  · effect 대신 이전 결과와 비교해 렌더 중 갱신(usePagination·BlockedIpClient와 같은 패턴).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.ok && typeof state.saved === "string") setReasons(state.saved);
  }

  // 지금 입력한 대로면 직원 화면에 어떻게 뜨는지(빈칸이면 기본 4종) — 저장 전에 눈으로 확인.
  const preview = parseOutingReasons(reasons);
  const overflow = normalizeOutingReasons(reasons).length < reasons.split(",").map((s) => s.trim()).filter(Boolean).length;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>외출 사유</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
        직원이 [출퇴근] 화면에서 <b>[외출]</b>을 누를 때 고르는 사유 목록입니다. 회사 사정에 맞게 바꾸세요.
        <br />
        쉼표(,)로 구분해 최대 {MAX_OUTING_REASONS}개, 하나당 {MAX_REASON_LEN}글자까지. <b>비워서 저장하면 기본값</b>(
        {formatOutingReasons(DEFAULT_OUTING_REASONS)})으로 돌아갑니다.
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="outing-reasons" style={{ display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            사유 목록 (쉼표로 구분)
          </label>
          <input
            id="outing-reasons"
            name="reasons"
            type="text"
            value={reasons}
            onChange={(e) => setReasons(e.target.value)}
            placeholder={formatOutingReasons(DEFAULT_OUTING_REASONS)}
            style={{ width: "100%", height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none" }}
          />
        </div>

        <div style={{ background: "#F9FAFB", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", marginBottom: 8 }}>직원 화면 미리보기</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {preview.map((r) => (
              <span key={r} style={{ fontSize: 13, fontWeight: 700, padding: "5px 10px", borderRadius: 999, background: "#fff", border: "1px solid var(--border)" }}>
                {r}
              </span>
            ))}
          </div>
          {overflow && (
            <div style={{ fontSize: 12, color: "var(--warning)", fontWeight: 700, marginTop: 8, wordBreak: "keep-all" }}>
              ⚠️ 중복이거나 {MAX_REASON_LEN}글자를 넘거나 {MAX_OUTING_REASONS}개를 초과한 항목은 저장되지 않습니다(위 미리보기가 실제 저장될 목록입니다).
            </div>
          )}
        </div>

        <p style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.6, wordBreak: "keep-all" }}>
          이미 기록된 과거 외출의 사유는 그대로 남습니다(이력 보존). 목록 변경은 앞으로의 외출에만 적용됩니다.
        </p>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
        {state?.ok && (
          <div style={{ fontSize: 13, color: state.warn ? "var(--warning)" : "var(--success)", fontWeight: 700, lineHeight: 1.6, wordBreak: "keep-all" }}>
            저장되었습니다.{state.warn ? ` ${state.warn}` : ""}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
        >
          {pending ? "저장 중..." : "저장"}
        </button>
      </form>
    </div>
  );
}
