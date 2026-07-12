"use client";
// 근무제·기준시간 설정 폼 — 출근/퇴근 기준시각은 [시][분] 드롭다운으로 쉽게 고른다. + 지각 유예(분).
// 지각/정상 판정의 기준. 시각을 "없음"으로 두면 지각 판정을 하지 않는다.
import { useActionState, useState } from "react";
import { saveWorkRules } from "@/app/actions/settings";
import { WEEK_ORDER, DAY_LABELS, parseDays, daysToCsv } from "@/lib/workdays";
import { TimePicker, splitTime, joinTime } from "@/app/components/TimePicker";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

export function WorkRulesForm({
  initial,
}: {
  initial: { start: string; end: string; grace: number; workDays: string; standardHours: number };
}) {
  const [state, formAction, pending] = useActionState(saveWorkRules, {});
  const s = splitTime(initial.start);
  const e = splitTime(initial.end);
  const [startH, setStartH] = useState(s.h);
  const [startM, setStartM] = useState(s.m);
  const [endH, setEndH] = useState(e.h);
  const [endM, setEndM] = useState(e.m);
  const [grace, setGrace] = useState(String(initial.grace));
  const [stdHours, setStdHours] = useState(String(initial.standardHours));
  const [days, setDays] = useState<Set<number>>(() => parseDays(initial.workDays));

  // 서버로는 기존과 똑같이 "HH:MM"(없으면 빈 값)으로 보낸다.
  const startVal = joinTime(startH, startM);
  const endVal = joinTime(endH, endM);

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>근무제·기준시간</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        표준 출근·퇴근 기준시각을 정하면 <b>지각·정상</b>을 판정할 수 있습니다. (기준시각 + 유예 이후 출근 = 지각)
        <br />
        시각을 <b>없음</b>으로 두면 지각 판정을 하지 않고 실근무시간만 기록합니다.
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <input type="hidden" name="workStartTime" value={startVal} />
        <input type="hidden" name="workEndTime" value={endVal} />
        <input type="hidden" name="workDays" value={daysToCsv(days)} />
        <input type="hidden" name="standardWorkHours" value={stdHours} />

        {/* 근무요일 — 이 요일에만 지각·결근을 판정한다 */}
        <div>
          <label style={labelStyle}>근무요일</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {WEEK_ORDER.map((d) => {
              const on = days.has(d);
              const weekend = d === 0 || d === 6;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  style={{
                    width: 46, height: 42, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700,
                    border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                    background: on ? "var(--primary)" : "#fff",
                    color: on ? "#fff" : weekend ? "var(--danger)" : "var(--text)",
                  }}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
            선택한 요일에만 지각·결근을 판정합니다. 요일이 다른 직원은 [직원 상세]에서 따로 지정할 수 있어요.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelStyle}>출근 기준시각</label>
            <TimePicker h={startH} m={startM} onH={setStartH} onM={setStartM} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelStyle}>퇴근 기준시각</label>
            <TimePicker h={endH} m={endM} onH={setEndH} onM={setEndM} />
          </div>
          <div style={{ width: 130 }}>
            <label style={labelStyle}>지각 유예(분)</label>
            <input name="lateGraceMin" type="number" min={0} max={120} value={grace} onChange={(ev) => setGrace(ev.target.value)}
              style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%" }} />
          </div>
        </div>

        {/* 기준 일 근무시간 — 하루 실근무가 이 시간을 넘으면 초과분을 연장근무로 집계 */}
        <div style={{ width: 200 }}>
          <label style={labelStyle}>기준 일 근무시간</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number" min={1} max={24} step={0.5} value={stdHours}
              onChange={(ev) => setStdHours(ev.target.value)}
              style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: 100 }}
            />
            <span style={{ fontSize: 15, color: "var(--text-sub)", fontWeight: 700 }}>시간</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
            하루 실근무가 이 시간을 넘으면 <b>초과분을 초과근무(연장)</b>로 리포트에 집계합니다. (기본 8시간)
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
