"use client";
// 휴가 신청 폼(직원) — 종류·기간·사유. 반차/병가는 하루만(종료일 숨김).
import { useActionState, useState } from "react";
import { requestLeave } from "@/app/actions/leave";
import { LEAVE_TYPES } from "@/lib/leave";

const inputStyle: React.CSSProperties = {
  width: "100%", height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, color: "var(--text)", outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function LeaveRequestForm() {
  const [state, formAction, pending] = useActionState(requestLeave, {});
  const [type, setType] = useState("annual");
  const singleDay = type === "half" || type === "sick"; // 하루짜리는 종료일 없음

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>종류</label>
        <select name="type" value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
          {LEAVE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>{singleDay ? "날짜" : "시작일"}</label>
          <input name="startDate" type="date" required style={inputStyle} />
        </div>
        {!singleDay && (
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>종료일</label>
            <input name="endDate" type="date" required style={inputStyle} />
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>사유 (선택)</label>
        <input name="reason" type="text" placeholder="예: 개인 사정, 병원 진료 등" style={inputStyle} />
      </div>

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>신청되었습니다. 관리자 승인을 기다려주세요.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
      >
        {pending ? "신청 중..." : "휴가 신청"}
      </button>
    </form>
  );
}
