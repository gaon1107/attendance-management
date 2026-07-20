"use client";
// 외출/외근 신청 폼(직원) — 종류·날짜·시각·장소·사유. (휴가 LeaveRequestForm 패턴)
import { useActionState, useState } from "react";
import { requestOuting } from "@/app/actions/outing";
import { OUTING_KINDS } from "@/lib/outing";
import { DatePicker } from "@/app/components/DatePicker";
import { TimePicker, joinTime } from "@/app/components/TimePicker";
import { AttachmentField } from "@/app/components/AttachmentField";

const inputStyle: React.CSSProperties = {
  width: "100%", height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, color: "var(--text)", outline: "none",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function OutingRequestForm() {
  const [state, formAction, pending] = useActionState(requestOuting, {});
  // 시각은 공통 TimePicker(시·분 드롭다운, 10분 단위). 값은 "HH:MM"으로 hidden input에 담아 서버로 보낸다.
  const [sH, setSH] = useState("09");
  const [sM, setSM] = useState("00");
  const [eH, setEH] = useState("18");
  const [eM, setEM] = useState("00");

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={labelStyle}>종류</label>
        <select name="kind" defaultValue="outing" style={inputStyle}>
          {OUTING_KINDS.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>날짜</label>
        <DatePicker name="targetDate" allowClear={false} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={labelStyle}>시작 시각</label>
          <TimePicker h={sH} m={sM} onH={setSH} onM={setSM} allowEmpty={false} />
          <input type="hidden" name="startTime" value={joinTime(sH, sM)} />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={labelStyle}>종료 시각</label>
          <TimePicker h={eH} m={eM} onH={setEH} onM={setEM} allowEmpty={false} />
          <input type="hidden" name="endTime" value={joinTime(eH, eM)} />
        </div>
      </div>

      <div>
        <label style={labelStyle}>행선지 (선택)</label>
        <input name="place" type="text" placeholder="예: 거래처, 은행, 관공서 등" style={inputStyle} />
      </div>

      <div>
        <label style={labelStyle}>사유 (선택)</label>
        <input name="reason" type="text" placeholder="예: 자재 수령, 업무 미팅 등" style={inputStyle} />
      </div>

      <AttachmentField requestType="outing" submit={state} />

      {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
      {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>신청되었습니다. 관리자 승인을 기다려주세요.</div>}

      <button
        type="submit"
        disabled={pending}
        style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}
      >
        {pending ? "신청 중..." : "외출/외근 신청"}
      </button>
    </form>
  );
}
