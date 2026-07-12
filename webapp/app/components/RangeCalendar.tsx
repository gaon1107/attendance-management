"use client";
// 공통 기간 선택 달력 팝업 — 시작~종료 날짜를 커스텀 달력으로 고른다(브라우저 기본 달력 대신).
//  · 어느 화면에서든 재사용: 적용을 누르면 onApply(from, to)를 호출한다(이동/조회/상태갱신은 호출한 화면이 결정).
//  · from/to/todayISO는 "YYYY-MM-DD" 문자열. 값 비교·범위 판단은 ISO 사전순 비교로 안전하게 처리한다.
//  · 처음 개발: 근태현황(2026-07). 표준 컴포넌트로 승격.
import { useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const navBtn: React.CSSProperties = {
  width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)",
  fontWeight: 700, cursor: "pointer",
};

export function RangeCalendar({
  from,
  to,
  todayISO,
  onApply,
}: {
  from: string;
  to: string;
  todayISO: string;
  onApply: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // 화면에 보여줄 달(첫날), 선택 중인 시작/종료
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const [y, m] = from.split("-").map(Number);
    return { y, m: (m || 1) - 1 };
  });
  const [selStart, setSelStart] = useState<string | null>(from);
  const [selEnd, setSelEnd] = useState<string | null>(to);

  function openCal() {
    // 열 때 현재 기간으로 초기화
    const [y, m] = from.split("-").map(Number);
    setView({ y, m: (m || 1) - 1 });
    setSelStart(from);
    setSelEnd(to);
    setOpen(true);
  }

  function pick(iso: string) {
    if (!selStart || (selStart && selEnd)) {
      setSelStart(iso);
      setSelEnd(null);
    } else {
      // 시작만 정해진 상태 → 종료 확정(거꾸로 고르면 자동으로 뒤바꿈)
      if (iso < selStart) {
        setSelEnd(selStart);
        setSelStart(iso);
      } else {
        setSelEnd(iso);
      }
    }
  }

  function apply() {
    const f = selStart ?? from;
    const t = selEnd ?? selStart ?? to;
    setOpen(false);
    onApply(f, t);
  }

  function setPreset(days: number) {
    // 오늘 기준 최근 N일(0이면 오늘 하루)
    const [ty, tm, tdd] = todayISO.split("-").map(Number);
    const startD = new Date(ty, tm - 1, tdd - days);
    const s = isoOf(startD.getFullYear(), startD.getMonth(), startD.getDate());
    setSelStart(s);
    setSelEnd(todayISO);
    setView({ y: startD.getFullYear(), m: startD.getMonth() });
  }

  // 달력 그리드
  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const lo = selStart && selEnd ? (selStart < selEnd ? selStart : selEnd) : selStart;
  const hi = selStart && selEnd ? (selStart < selEnd ? selEnd : selStart) : selStart;

  const shiftMonth = (dir: number) => {
    const d = new Date(view.y, view.m + dir, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={openCal}
        style={{ height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}
      >
        📅 <span style={{ fontVariantNumeric: "tabular-nums" }}>{from} ~ {to}</span>
      </button>

      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: 44, left: 0, zIndex: 41, width: 300, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.16)", padding: 14 }}>
            {/* 빠른 선택 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {[{ l: "오늘", d: 0 }, { l: "최근 7일", d: 6 }, { l: "최근 30일", d: 29 }].map((p) => (
                <button key={p.l} type="button" onClick={() => setPreset(p.d)} style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 999, background: "#F9FAFB", color: "var(--text-sub)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {p.l}
                </button>
              ))}
            </div>

            {/* 월 이동 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <button type="button" onClick={() => shiftMonth(-1)} style={navBtn}>◀</button>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{view.y}년 {view.m + 1}월</div>
              <button type="button" onClick={() => shiftMonth(1)} style={navBtn}>▶</button>
            </div>

            {/* 요일 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
              {WEEK.map((w, i) => (
                <div key={w} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: i === 0 ? "#DC2626" : i === 6 ? "#2563EB" : "var(--text-sub)", padding: "4px 0" }}>{w}</div>
              ))}
            </div>

            {/* 날짜 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
              {cells.map((d, i) => {
                if (d === null) return <div key={`e${i}`} />;
                const iso = isoOf(view.y, view.m, d);
                const isEndpoint = iso === selStart || iso === selEnd;
                const inRange = !!lo && !!hi && iso >= lo && iso <= hi;
                const isToday = iso === todayISO;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => pick(iso)}
                    style={{
                      height: 34, border: "none", borderRadius: 8, cursor: "pointer",
                      fontSize: 13, fontWeight: isEndpoint ? 800 : 600, fontFamily: "inherit",
                      background: isEndpoint ? "var(--primary)" : inRange ? "#DBEAFE" : "transparent",
                      color: isEndpoint ? "#fff" : inRange ? "#1D4ED8" : "var(--text)",
                      outline: isToday && !isEndpoint ? "1px solid var(--primary)" : "none",
                      outlineOffset: -1,
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>

            {/* 선택 요약 + 적용 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
                {selStart ?? "—"} ~ {selEnd ?? selStart ?? "—"}
              </div>
              <button type="button" onClick={apply} style={{ height: 34, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                적용
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
