"use client";
// 근태 정정 요청 폼(직원) — 날짜 + 출근/퇴근 시각(최소 하나) + 사유.
import { useActionState, useEffect, useRef } from "react";
import { requestCorrection } from "@/app/actions/corrections";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };
const inputStyle: React.CSSProperties = {
  height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%", background: "#fff",
};

export function CorrectionRequestForm() {
  const [state, formAction, pending] = useActionState(requestCorrection, {});
  const formRef = useRef<HTMLFormElement>(null);

  // 성공했을 때만 폼을 비운다(실패 시 입력값 보존).
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div>
        <label style={labelStyle}>정정할 날짜</label>
        <input name="targetDate" type="date" style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 140px" }}>
          <label style={labelStyle}>출근 시각 (선택)</label>
          <input name="requestedIn" type="time" style={inputStyle} />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label style={labelStyle}>퇴근 시각 (선택)</label>
          <input name="requestedOut" type="time" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>정정 사유</label>
        <input name="reason" type="text" placeholder="예: 출근 체크를 깜빡했습니다" style={inputStyle} />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>정정 요청을 접수했습니다. 관리자 승인을 기다려주세요.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
      >
        {pending ? "접수 중..." : "정정 요청하기"}
      </button>
    </form>
  );
}
