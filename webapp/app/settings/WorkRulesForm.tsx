"use client";
// 근무제·기준시간 설정 폼 — 출근/퇴근 기준시각은 [시][분] 드롭다운으로 쉽게 고른다. + 지각 유예(분).
// 지각/정상 판정의 기준. 시각을 "없음"으로 두면 지각 판정을 하지 않는다.
import { useActionState, useState } from "react";
import { saveWorkRules } from "@/app/actions/settings";
import { WEEK_ORDER, DAY_LABELS, parseDays, daysToCsv } from "@/lib/workdays";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "10", "20", "30", "40", "50"];

// "HH:MM" → {h, m}. 값이 없거나 형식이 안 맞으면 "없음"(h="").
function splitTime(t: string): { h: string; m: string } {
  if (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
    const [h, m] = t.split(":");
    return { h, m: MINUTES.includes(m) ? m : "00" };
  }
  return { h: "", m: "00" };
}

const selectStyle: React.CSSProperties = {
  height: 44,
  padding: "0 10px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  background: "#fff",
  color: "var(--text)",
  cursor: "pointer",
  flex: 1,
  minWidth: 0,
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };

function TimePicker({ h, m, onH, onM }: { h: string; m: string; onH: (v: string) => void; onM: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <select value={h} onChange={(e) => onH(e.target.value)} style={selectStyle}>
        <option value="">없음</option>
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>{hh}시</option>
        ))}
      </select>
      <select value={m} onChange={(e) => onM(e.target.value)} style={{ ...selectStyle, opacity: h === "" ? 0.5 : 1 }} disabled={h === ""}>
        {MINUTES.map((mm) => (
          <option key={mm} value={mm}>{mm}분</option>
        ))}
      </select>
    </div>
  );
}

export function WorkRulesForm({
  initial,
}: {
  initial: { start: string; end: string; grace: number; workDays: string };
}) {
  const [state, formAction, pending] = useActionState(saveWorkRules, {});
  const s = splitTime(initial.start);
  const e = splitTime(initial.end);
  const [startH, setStartH] = useState(s.h);
  const [startM, setStartM] = useState(s.m);
  const [endH, setEndH] = useState(e.h);
  const [endM, setEndM] = useState(e.m);
  const [grace, setGrace] = useState(String(initial.grace));
  const [days, setDays] = useState<Set<number>>(() => parseDays(initial.workDays));

  // 서버로는 기존과 똑같이 "HH:MM"(없으면 빈 값)으로 보낸다.
  const startVal = startH === "" ? "" : `${startH}:${startM}`;
  const endVal = endH === "" ? "" : `${endH}:${endM}`;

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 20 }}>
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
