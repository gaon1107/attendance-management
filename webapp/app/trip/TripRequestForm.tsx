"use client";
// 출장 신청 폼(직원) — 기간(시작~종료)·출장지·사유. (재택 폼 패턴 + 출장지)
import { useActionState } from "react";
import { requestTrip } from "@/app/actions/trip";
import { RangeDatePicker } from "@/app/components/RangeDatePicker";
import { AttachmentField } from "@/app/components/AttachmentField";

const inputStyle: React.CSSProperties = {
  width: "100%", height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, color: "var(--text)", outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function TripRequestForm() {
  const [state, formAction, pending] = useActionState(requestTrip, {});

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>출장 기간</label>
        <RangeDatePicker startName="startDate" endName="endDate" placeholder="출장 기간 선택" />
      </div>

      <div>
        <label style={labelStyle}>출장지</label>
        <input name="destination" type="text" required maxLength={200} placeholder="예: 부산 지사, 대전 고객사 등" style={inputStyle} />
      </div>

      <div>
        <label style={labelStyle}>목적/사유 (선택)</label>
        <input name="reason" type="text" placeholder="예: 설비 점검, 계약 미팅 등" style={inputStyle} />
      </div>

      <AttachmentField requestType="trip" submit={state} />

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>신청되었습니다. 관리자 승인을 기다려주세요.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
      >
        {pending ? "신청 중..." : "출장 신청"}
      </button>
    </form>
  );
}
