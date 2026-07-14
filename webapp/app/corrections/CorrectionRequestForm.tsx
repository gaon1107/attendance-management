"use client";
// 근태 정정 요청 폼(직원) — 날짜 + 출근/퇴근 시각(최소 하나) + 사유.
//  · 날짜=공통 DatePicker, 시각=공통 TimePicker. 시각은 1분 단위(00~59)로 정밀 입력(시각 정정 특성상).
import { useActionState, useEffect, useRef, useState } from "react";
import { requestCorrection } from "@/app/actions/corrections";
import { DatePicker } from "@/app/components/DatePicker";
import { TimePicker, joinTime } from "@/app/components/TimePicker";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };
const inputStyle: React.CSSProperties = {
  height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8,
  fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%", background: "#fff",
};

// 시각 정정은 정밀도가 중요 → 분을 1분 단위(00~59)로 제공.
const MIN60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

export function CorrectionRequestForm() {
  const [state, formAction, pending] = useActionState(requestCorrection, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [inH, setInH] = useState("");
  const [inM, setInM] = useState("00");
  const [outH, setOutH] = useState("");
  const [outM, setOutM] = useState("00");
  const [resetKey, setResetKey] = useState(0); // 성공 시 DatePicker를 remount해 초기화하기 위한 키

  // 성공했을 때만 폼을 비운다(실패 시 입력값 보존).
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset(); // 사유 등 일반 입력
      setInH(""); setInM("00"); setOutH(""); setOutM("00"); // 시각(컨트롤드) 초기화
      setResetKey((k) => k + 1); // 날짜(DatePicker) 초기화
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div>
        <label style={labelStyle}>정정할 날짜</label>
        <DatePicker key={resetKey} name="targetDate" allowClear={false} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 140px" }}>
          <label style={labelStyle}>출근 시각 (선택)</label>
          <TimePicker h={inH} m={inM} onH={setInH} onM={setInM} minutes={MIN60} />
          <input type="hidden" name="requestedIn" value={joinTime(inH, inM)} />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label style={labelStyle}>퇴근 시각 (선택)</label>
          <TimePicker h={outH} m={outM} onH={setOutH} onM={setOutM} minutes={MIN60} />
          <input type="hidden" name="requestedOut" value={joinTime(outH, outM)} />
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
