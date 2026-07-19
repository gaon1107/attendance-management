"use client";
// 근무표 — [방식 ⓐ 고정] 요일 패턴 편집. 직원 × 요일 → 조 드롭다운. 저장하면 매주 자동 반복.
//  · 그날 실제 조 = (날짜 예외) → 이 요일 패턴 → 휴무. (예외·자정판정은 이후 Phase)
import { useActionState, useState } from "react";
import { saveFixedPattern } from "@/app/actions/shift";

export type ShiftDef = { id: string; order: number; name: string | null; startTime: string; endTime: string };
export type EmpLite = { id: string; name: string; employeeNo: string | null };

const DAYS = [
  { dow: 1, label: "월" }, { dow: 2, label: "화" }, { dow: 3, label: "수" },
  { dow: 4, label: "목" }, { dow: 5, label: "금" }, { dow: 6, label: "토", we: true }, { dow: 0, label: "일", we: true },
];

const th: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "10px 12px", whiteSpace: "nowrap", textAlign: "center" };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 14, verticalAlign: "middle", textAlign: "center" };
const selStyle: React.CSSProperties = { height: 36, padding: "0 8px", border: "1px solid #D1D5DB", borderRadius: 7, fontFamily: "inherit", fontSize: 13, background: "#fff", cursor: "pointer", minWidth: 78 };

const isNight = (s: ShiftDef) => s.endTime <= s.startTime;
const shiftName = (s: ShiftDef) => `${s.order}교대${s.name ? `(${s.name})` : ""}`;

export function FixedPatternClient({ employees, shifts, initialPatterns }: { employees: EmpLite[]; shifts: ShiftDef[]; initialPatterns: Record<string, string> }) {
  const [state, formAction, pending] = useActionState(saveFixedPattern, {});
  const [pat, setPat] = useState<Record<string, string>>(initialPatterns);
  const key = (uid: string, dow: number) => `${uid}_${dow}`;
  const setCell = (uid: string, dow: number, v: string) => setPat((prev) => ({ ...prev, [key(uid, dow)]: v }));

  return (
    <form action={formAction}>
      <input type="hidden" name="userIds" value={employees.map((e) => e.id).join(",")} />
      {employees.flatMap((e) => DAYS.map((d) => (
        <input key={`h_${e.id}_${d.dow}`} type="hidden" name={`pat_${e.id}_${d.dow}`} value={pat[key(e.id, d.dow)] ?? ""} />
      )))}

      {/* 조 범례 */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, fontSize: 13 }}>
        {shifts.map((s) => (
          <span key={s.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "5px 12px", fontWeight: 700 }}>
            {shiftName(s)} <span style={{ color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{s.startTime}~{s.endTime}</span>
            {isNight(s) && <span style={{ color: "var(--warning)", marginLeft: 4 }}>🌙야간</span>}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 12, lineHeight: 1.6 }}>
        요일마다 각 직원의 조를 정하면 <b>매주 자동으로 반복</b>됩니다. 특정 날만 다르게 하는 건(예외) 이후 단계에서 추가됩니다.
      </div>

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ ...th, textAlign: "left" }}>직원</th>
                {DAYS.map((d) => (
                  <th key={d.dow} style={{ ...th, color: d.we ? "var(--danger)" : "var(--text-sub)" }}>{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={8} style={{ ...td, padding: "28px 12px", color: "var(--text-sub)" }}>재직 중인 직원이 없습니다. [직원관리]에서 먼저 추가하세요.</td></tr>
              ) : (
                employees.map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, textAlign: "left" }}>
                      <div style={{ fontWeight: 700 }}>{e.name}</div>
                      {e.employeeNo && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>사번 {e.employeeNo}</div>}
                    </td>
                    {DAYS.map((d) => (
                      <td key={d.dow} style={td}>
                        <select value={pat[key(e.id, d.dow)] ?? ""} onChange={(ev) => setCell(e.id, d.dow, ev.target.value)} style={selStyle}>
                          <option value="">휴무</option>
                          {shifts.map((s) => <option key={s.id} value={s.id}>{s.order}교대</option>)}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
        <button type="submit" disabled={pending}
          style={{ height: 46, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending ? 0.6 : 1, padding: "0 28px" }}>
          {pending ? "저장 중..." : "근무표 저장"}
        </button>
        {state?.ok && <span style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</span>}
        {state?.error && <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</span>}
      </div>
    </form>
  );
}
