"use client";
// 재택근무 신청 폼(직원) — 기간(시작~종료)·사유. (휴가 LeaveRequestForm 패턴)
import { useActionState } from "react";
import { requestRemote } from "@/app/actions/remote";
import { RangeDatePicker } from "@/app/components/RangeDatePicker";
import { AttachmentField } from "@/app/components/AttachmentField";

const inputStyle: React.CSSProperties = {
  width: "100%", height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, color: "var(--text)", outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function RemoteRequestForm() {
  const [state, formAction, pending] = useActionState(requestRemote, {});

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>재택 기간</label>
        <RangeDatePicker startName="startDate" endName="endDate" placeholder="재택 기간 선택" />
      </div>

      <div>
        <label style={labelStyle}>사유 (선택)</label>
        <input name="reason" type="text" placeholder="예: 자녀 돌봄, 원격 협업 등" style={inputStyle} />
      </div>

      <AttachmentField requestType="remote" submit={state} />

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>신청되었습니다. 관리자 승인을 기다려주세요.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
      >
        {pending ? "신청 중..." : "재택근무 신청"}
      </button>
    </form>
  );
}
