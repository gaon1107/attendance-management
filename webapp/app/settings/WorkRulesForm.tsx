"use client";
// 근무제·기준시간 설정 폼 — 출근/퇴근 기준시각([시][분]) + 지각 유예 + 기준 일 근무시간 + 주52 알림.
//  · 교대근무(2/3교대): 조별 출근·퇴근 시각을 정의하고 근무표 방식(고정/순환)을 고른다.
//    "안 함"이면 단일 기준시각(현행). 교대 정의·저장은 saveWorkRules가 함께 처리(조는 order 기준 upsert).
import { useActionState, useState } from "react";
import { saveWorkRules } from "@/app/actions/settings";
import { WEEK_ORDER, DAY_LABELS, parseDays, daysToCsv } from "@/lib/workdays";
import { TimePicker, splitTime, joinTime } from "@/app/components/TimePicker";

const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 };
const selStyle: React.CSSProperties = { height: 38, padding: "0 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: "#fff", cursor: "pointer" };

type SavedShift = { order: number; name: string | null; startTime: string; endTime: string };
type SRow = { name: string; sh: string; sm: string; eh: string; em: string };

function buildShifts(mode: number, saved: SavedShift[]): SRow[] {
  const rows: SRow[] = [];
  for (let i = 1; i <= mode; i++) {
    const f = saved.find((s) => s.order === i);
    const st = f ? splitTime(f.startTime) : { h: "09", m: "00" };
    const et = f ? splitTime(f.endTime) : { h: "18", m: "00" };
    rows.push({ name: f?.name ?? "", sh: st.h, sm: st.m, eh: et.h, em: et.m });
  }
  return rows;
}

export function WorkRulesForm({
  initial,
}: {
  initial: {
    start: string; end: string; grace: number; workDays: string; standardHours: number;
    overtimeAlertOn: boolean; overtimeWarnHours: number;
    shiftMode: number; scheduleType: string; shifts: SavedShift[];
  };
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
  const [otOn, setOtOn] = useState(initial.overtimeAlertOn);
  const [otWarn, setOtWarn] = useState(String(initial.overtimeWarnHours));
  const [days, setDays] = useState<Set<number>>(() => parseDays(initial.workDays));
  // 교대근무
  const [shiftMode, setShiftMode] = useState(initial.shiftMode || 0);
  const [scheduleType, setScheduleType] = useState(initial.scheduleType || "fixed");
  const [shifts, setShifts] = useState<SRow[]>(() => buildShifts(initial.shiftMode || 0, initial.shifts));

  const startVal = joinTime(startH, startM);
  const endVal = joinTime(endH, endM);

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }
  function changeMode(m: number) {
    setShiftMode(m);
    setShifts((prev) => {
      const next = [...prev];
      while (next.length < m) next.push({ name: "", sh: "09", sm: "00", eh: "18", em: "00" });
      return next.slice(0, m);
    });
  }
  function updShift(i: number, k: keyof SRow, v: string) {
    setShifts((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  }

  const graceInput = (
    <div style={{ width: 130 }}>
      <label style={labelStyle}>지각 유예(분)</label>
      <input name="lateGraceMin" type="number" min={0} max={120} value={grace} onChange={(ev) => setGrace(ev.target.value)}
        style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%" }} />
    </div>
  );

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>근무제·기준시간</div>
      <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        표준 출근·퇴근 기준시각을 정하면 <b>지각·조퇴·정상</b>을 판정합니다. 해당 시각을 <b>없음</b>으로 두면 그 판정을 하지 않습니다.
        <br />교대근무면 <b>조별 시각</b>과 <b>근무표 방식</b>을 정합니다(직원 배정은 [근무표]에서).
      </p>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <input type="hidden" name="workStartTime" value={startVal} />
        <input type="hidden" name="workEndTime" value={endVal} />
        <input type="hidden" name="workDays" value={daysToCsv(days)} />
        <input type="hidden" name="standardWorkHours" value={stdHours} />
        <input type="hidden" name="overtimeWarnHours" value={otWarn} />
        <input type="hidden" name="shiftMode" value={shiftMode} />
        <input type="hidden" name="scheduleType" value={scheduleType} />
        {shiftMode > 0 && shifts.flatMap((r, i) => [
          <input key={`n${i}`} type="hidden" name={`shift${i + 1}Name`} value={r.name} />,
          <input key={`s${i}`} type="hidden" name={`shift${i + 1}Start`} value={joinTime(r.sh, r.sm)} />,
          <input key={`e${i}`} type="hidden" name={`shift${i + 1}End`} value={joinTime(r.eh, r.em)} />,
        ])}

        {/* 근무요일 + 교대근무 선택 */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <label style={labelStyle}>근무요일</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              교대근무
              <select value={shiftMode} onChange={(ev) => changeMode(Number(ev.target.value))} style={selStyle}>
                <option value={0}>안 함</option>
                <option value={2}>2교대</option>
                <option value={3}>3교대</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {WEEK_ORDER.map((d) => {
              const on = days.has(d);
              const weekend = d === 0 || d === 6;
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  style={{ width: 46, height: 42, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700,
                    border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`, background: on ? "var(--primary)" : "#fff",
                    color: on ? "#fff" : weekend ? "var(--danger)" : "var(--text)" }}>
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
            선택한 요일에만 지각·결근을 판정합니다. 요일이 다른 직원은 [직원 상세]에서 따로 지정할 수 있어요.
          </div>
        </div>

        {shiftMode === 0 ? (
          // 비교대 — 단일 기준시각(현행)
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={labelStyle}>출근 기준시각</label>
              <TimePicker h={startH} m={startM} onH={setStartH} onM={setStartM} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={labelStyle}>퇴근 기준시각</label>
              <TimePicker h={endH} m={endM} onH={setEndH} onM={setEndM} />
            </div>
            {graceInput}
          </div>
        ) : (
          // 교대근무 — 근무표 방식 + 조별 시각 + 공통 유예
          <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={labelStyle}>근무표 방식</label>
                <select value={scheduleType} onChange={(ev) => setScheduleType(ev.target.value)} style={{ ...selStyle, height: 44 }}>
                  <option value="fixed">고정(요일별 패턴)</option>
                  <option value="rotation">순환(조가 규칙대로 이동)</option>
                </select>
              </div>
              {graceInput}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-sub)" }}>
              직원을 각 조에 배정하는 건 <b>[근무표]</b> 화면에서 합니다. 여기선 <b>조별 시각</b>만 정합니다. 지각 유예는 회사 공통입니다.
            </div>
            {shifts.map((r, i) => {
              const night = joinTime(r.eh, r.em) <= joinTime(r.sh, r.sm);
              return (
                <div key={i} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", background: "var(--bg)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ width: 54, fontSize: 14, fontWeight: 800, color: "var(--primary)", paddingBottom: 10 }}>{i + 1}교대</div>
                  <div style={{ width: 130 }}>
                    <label style={{ ...labelStyle, marginBottom: 6 }}>조 이름(선택)</label>
                    <input value={r.name} onChange={(ev) => updShift(i, "name", ev.target.value)} placeholder={`${i + 1}교대`}
                      style={{ height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 6 }}>출근</label>
                    <TimePicker h={r.sh} m={r.sm} onH={(v) => updShift(i, "sh", v)} onM={(v) => updShift(i, "sm", v)} allowEmpty={false} />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 6 }}>퇴근</label>
                    <TimePicker h={r.eh} m={r.em} onH={(v) => updShift(i, "eh", v)} onM={(v) => updShift(i, "em", v)} allowEmpty={false} />
                  </div>
                  {night && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)", paddingBottom: 12 }}>🌙 야간(익일 퇴근)</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* 기준 일 근무시간 */}
        <div style={{ width: 200 }}>
          <label style={labelStyle}>기준 일 근무시간</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={1} max={24} step={0.5} value={stdHours} onChange={(ev) => setStdHours(ev.target.value)}
              style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: 100 }} />
            <span style={{ fontSize: 15, color: "var(--text-sub)", fontWeight: 700 }}>시간</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
            하루 실근무가 이 시간을 넘으면 <b>초과분을 초과근무(연장)</b>로 리포트에 집계합니다. (기본 8시간)
          </div>
        </div>

        {/* 주 52시간 초과근무 알림 */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
            <input type="checkbox" name="overtimeAlertOn" checked={otOn} onChange={(ev) => setOtOn(ev.target.checked)} style={{ width: 18, height: 18 }} />
            주 52시간 초과근무 알림 켜기
          </label>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8, marginBottom: 12, lineHeight: 1.6 }}>
            이번 주(월요일~현재) 실근무 합계가 <b>법정 상한(주 52시간)</b>에 근접·초과한 직원을 <b>대시보드 오늘 알림</b>에 표시합니다.
            <br />5인 미만 사업장·특례업종이면 꺼두세요. (문자·이메일 자동발송은 하지 않습니다 — 화면 알림만)
          </div>
          <div style={{ width: 200, opacity: otOn ? 1 : 0.5 }}>
            <label style={labelStyle}>근접 경고선</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" min={30} max={52} step={1} value={otWarn} disabled={!otOn} onChange={(ev) => setOtWarn(ev.target.value)}
                style={{ height: 44, padding: "0 14px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none", width: 100 }} />
              <span style={{ fontSize: 15, color: "var(--text-sub)", fontWeight: 700 }}>시간</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8, lineHeight: 1.5 }}>
              이 시간 이상이면 <b>근접(노랑)</b>, 52시간 이상이면 <b>초과(빨강)</b>로 알립니다. (기본 48시간, 30~52)
            </div>
          </div>
        </div>

        {state?.error && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</div>}
        {state?.ok && <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</div>}

        <button type="submit" disabled={pending}
          style={{ height: 48, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, alignSelf: "flex-start", padding: "0 28px" }}>
          {pending ? "저장 중..." : "저장"}
        </button>
      </form>
    </div>
  );
}
