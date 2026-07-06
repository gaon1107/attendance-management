"use client";
// 근무제·기준시간 설정 폼 — 표준 출퇴근 기준시각 + 지각 유예(분).
// 지각/정상 판정의 기준이 된다. 비워두면 지각 판정을 하지 않는다.
import { useActionState, useState } from "react";
import { saveWorkRules } from "@/app/actions/settings";

const inputStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  outline: "none",
  width: "100%",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function WorkRulesForm({
  initial,
}: {
  initial: { start: string; end: string; grace: number };
}) {
  const [state, formAction, pending] = useActionState(saveWorkRules, {});
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [grace, setGrace] = useState(String(initial.grace));

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>근무제·기준시간</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        표준 출근·퇴근 기준시각을 정하면 <b>지각·정상</b>을 판정할 수 있습니다. (기준시각 + 유예 이후 출근 = 지각)
        <br />
        비워두면 지각 판정을 하지 않고 실근무시간만 기록합니다.
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>출근 기준시각</label>
            <input name="workStartTime" type="time" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={labelStyle}>퇴근 기준시각</label>
            <input name="workEndTime" type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ width: 140 }}>
            <label style={labelStyle}>지각 유예(분)</label>
            <input name="lateGraceMin" type="number" min={0} max={120} value={grace} onChange={(e) => setGrace(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
        {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

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
