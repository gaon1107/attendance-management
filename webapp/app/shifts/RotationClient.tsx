"use client";
// 근무표 — [방식 ⓑ 순환] 조(A/B/C) 배정 + 순환 규칙(단위·시작 기준일). 순환 순서는 표준 고정(1교대→2교대→…).
//  · 그날 실제 조 = (날짜 예외) → 순환 규칙 → 휴무. (예외·자정판정은 이후 Phase)
//  · 미리보기는 순수함수 rotationShiftOrder/elapsedUnits로 계산(설계와 동일 수식) → 저장 전 눈으로 검증.
import { useActionState, useMemo, useState } from "react";
import { saveRotation } from "@/app/actions/shift";
import { rotationShiftOrder, elapsedUnits, crossesMidnight, type RotationUnit } from "@/lib/shift";

export type ShiftDef = { id: string; order: number; name: string | null; startTime: string; endTime: string };
export type EmpLite = { id: string; name: string; employeeNo: string | null };
export type RuleLite = { orderCsv: string; unit: string; anchorDate: string } | null;

const selStyle: React.CSSProperties = { height: 38, padding: "0 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: "#fff", cursor: "pointer" };
const th: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "10px 12px", whiteSpace: "nowrap", textAlign: "center" };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 14, verticalAlign: "middle", textAlign: "center" };

const groupLabel = (order: number) => `${String.fromCharCode(65 + order)}조`; // 0→A조, 1→B조, 2→C조
const isNight = (s: ShiftDef) => crossesMidnight(s);
const shiftName = (s: ShiftDef) => `${s.order}교대${s.name ? `(${s.name})` : ""}`;

const UNIT_OPTS: { v: RotationUnit; label: string; word: string }[] = [
  { v: "day", label: "매일 (하루마다 조 이동)", word: "일" },
  { v: "week", label: "매주 (월요일마다 조 이동)", word: "주" },
  { v: "month", label: "매월 (매월 1일마다 조 이동)", word: "달" },
];

// 브라우저 오늘 날짜 "YYYY-MM-DD"
function todayISO(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function RotationClient({
  shiftMode, employees, shifts, initialAssign, initialRule,
}: {
  shiftMode: number;
  employees: EmpLite[];
  shifts: ShiftDef[];
  initialAssign: Record<string, string>;
  initialRule: RuleLite;
}) {
  const [state, formAction, pending] = useActionState(saveRotation, {});
  const [assign, setAssign] = useState<Record<string, string>>(initialAssign);
  const [unit, setUnit] = useState<string>(initialRule?.unit ?? "week");
  const [anchorDate, setAnchorDate] = useState<string>(initialRule?.anchorDate ?? todayISO());

  const groupOrders = Array.from({ length: shiftMode }, (_, i) => i); // 0..n-1
  const shiftByOrder = useMemo(() => {
    const m = new Map<number, ShiftDef>();
    for (const s of shifts) m.set(s.order, s);
    return m;
  }, [shifts]);
  // 순환 순서는 표준 고정 불변식(1..shiftMode). 저장값(orderCsv)에 의존하지 않아
  // [설정]에서 교대수를 바꾼 뒤에도 미리보기가 항상 현재 교대수 기준으로 정확하다.
  const orderArr = useMemo(() => Array.from({ length: shiftMode }, (_, i) => i + 1), [shiftMode]);

  const unitWord = UNIT_OPTS.find((u) => u.v === unit)?.word ?? "주";
  const validAnchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorDate);

  // 미리보기: 이번/다음/다다음 단위에 각 조가 맡는 교대. steps만으로 계산(날짜 무관).
  const preview = useMemo(() => {
    if (!validAnchor) return null;
    const base = elapsedUnits(anchorDate, todayISO(), unit as RotationUnit);
    const cols = [
      { k: 0, label: `이번 ${unitWord}` },
      { k: 1, label: `다음 ${unitWord}` },
      { k: 2, label: `다다음 ${unitWord}` },
    ];
    return { base, cols };
  }, [validAnchor, anchorDate, unit, unitWord]);

  // 유효 배정(현재 교대수 안의 조)만 센다 — 교대수 축소 후 남은 옛 조 값(빈칸 표시)을 배정으로 오인하지 않게.
  const assigned = employees.filter((e) => {
    const v = assign[e.id];
    return v !== undefined && v !== "" && /^\d+$/.test(v) && Number(v) < shiftMode;
  }).length;

  return (
    <form action={formAction}>
      <input type="hidden" name="userIds" value={employees.map((e) => e.id).join(",")} />
      {employees.map((e) => (
        <input key={`h_${e.id}`} type="hidden" name={`group_${e.id}`} value={assign[e.id] ?? ""} />
      ))}
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="anchorDate" value={anchorDate} />

      {/* 조 범례 */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, fontSize: 13 }}>
        {shifts.map((s) => (
          <span key={s.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "5px 12px", fontWeight: 700 }}>
            {shiftName(s)} <span style={{ color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{s.startTime}~{s.endTime}</span>
            {isNight(s) && <span style={{ color: "var(--warning)", marginLeft: 4 }}>🌙야간</span>}
          </span>
        ))}
      </div>

      {/* ① 순환 규칙 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>① 순환 규칙</div>
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 14, lineHeight: 1.6 }}>
          정한 <b>단위</b>마다 각 조가 다음 교대로 넘어갑니다. 순서는 <b>1교대→2교대{shiftMode >= 3 ? "→3교대" : ""}→(다시 1교대)</b> 표준 순서입니다.
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700 }}>
            순환 단위
            <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ ...selStyle, height: 44, minWidth: 220 }}>
              {UNIT_OPTS.map((u) => <option key={u.v} value={u.v}>{u.label}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700 }}>
            시작 기준일
            <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)}
              style={{ height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, outline: "none" }} />
          </label>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
          시작 기준일에 <b>A조가 1교대</b>부터 시작합니다. (예: 이번 주 월요일을 기준일로)
        </div>
      </section>

      {/* ② 미리보기 */}
      {preview && (
        <section style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>② 미리보기 — 각 조가 맡는 교대</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 360 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>조</th>
                  {preview.cols.map((c) => <th key={c.k} style={th}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {groupOrders.map((go) => (
                  <tr key={go} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{groupLabel(go)}</td>
                    {preview.cols.map((c) => {
                      const ord = rotationShiftOrder(go, preview.base + c.k, orderArr);
                      const s = shiftByOrder.get(ord);
                      return (
                        <td key={c.k} style={td}>
                          {s ? (
                            <span style={{ fontWeight: 700 }}>
                              {s.order}교대
                              {isNight(s) && <span style={{ color: "var(--warning)", marginLeft: 3 }}>🌙</span>}
                              <div style={{ fontSize: 11, color: "var(--text-sub)", fontWeight: 400 }}>{s.startTime}~{s.endTime}</div>
                            </span>
                          ) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 8 }}>
            ※ 미배정 직원은 순환에서 빠집니다(휴무 처리). 판정 반영은 다음 단계에서 연결됩니다.
          </div>
        </section>
      )}

      {/* ③ 직원 조 배정 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px 0", fontSize: 15, fontWeight: 800 }}>③ 직원 조 배정 <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-sub)" }}>({assigned}/{employees.length}명 배정)</span></div>
        <div style={{ overflowX: "auto", padding: "10px 0 0" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ ...th, textAlign: "left" }}>직원</th>
                <th style={th}>소속 조</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={2} style={{ ...td, padding: "28px 12px", color: "var(--text-sub)" }}>재직 중인 직원이 없습니다. [직원관리]에서 먼저 추가하세요.</td></tr>
              ) : (
                employees.map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, textAlign: "left" }}>
                      <div style={{ fontWeight: 700 }}>{e.name}</div>
                      {e.employeeNo && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>사번 {e.employeeNo}</div>}
                    </td>
                    <td style={td}>
                      <select value={assign[e.id] ?? ""} onChange={(ev) => setAssign((p) => ({ ...p, [e.id]: ev.target.value }))} style={{ ...selStyle, minWidth: 110 }}>
                        <option value="">미배정</option>
                        {groupOrders.map((go) => <option key={go} value={go}>{groupLabel(go)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
        <button type="submit" disabled={pending || !validAnchor}
          style={{ height: 46, border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: pending ? "default" : "pointer", opacity: pending || !validAnchor ? 0.6 : 1, padding: "0 28px" }}>
          {pending ? "저장 중..." : "근무표 저장"}
        </button>
        {state?.ok && <span style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>저장되었습니다.</span>}
        {state?.error && <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 700 }}>{state.error}</span>}
      </div>
    </form>
  );
}
