"use client";
// 공통 기간 입력 달력(폼용) — 시작~종료를 한 개 범위 달력으로 고른다(브라우저 기본 달력 대신).
//  · 조회 필터용 RangeCalendar와 같은 팝업 룩이되, "폼 입력"이라 과거 프리셋(최근 7·30일)은 두지 않는다.
//  · 서버로는 내부 hidden input 두 개(startName·endName)로 제출 → 기존 폼/서버액션(FormData)이 그대로 동작.
//  · 신청 기간(휴가 여러날·출장·재택)에 쓴다. 하루짜리(반차 등) 단일 날짜는 DatePicker를 쓴다.
import { useState } from "react";
import { toISODate } from "@/lib/period";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const navBtn: React.CSSProperties = {
  width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)",
  fontWeight: 700, cursor: "pointer",
};

export function RangeDatePicker({
  startName,
  endName,
  defaultStart = "",
  defaultEnd = "",
  placeholder = "기간 선택",
  allowClear = false,
}: {
  startName: string;
  endName: string;
  defaultStart?: string;
  defaultEnd?: string;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [start, setStart] = useState(isYmd(defaultStart) ? defaultStart : "");
  const [end, setEnd] = useState(isYmd(defaultEnd) ? defaultEnd : "");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    if (isYmd(defaultStart)) {
      const [y, m] = defaultStart.split("-").map(Number);
      return { y, m: m - 1 };
    }
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  // 오늘 표시(그리드 강조)용 — 팝업(클라이언트 전용, open일 때만 렌더)에서만 쓰이므로 렌더에서 직접 계산해도 하이드레이션 안전.
  const todayISO = toISODate(new Date());

  function openCal() {
    if (isYmd(start)) {
      const [y, m] = start.split("-").map(Number);
      setView({ y, m: m - 1 });
    }
    setOpen(true);
  }

  // 범위 선택: 시작만 있거나 둘 다 있으면 새로 시작. 시작만 있는 상태면 종료 확정(거꾸로 고르면 자동 스왑).
  function pick(iso: string) {
    if (!start || (start && end)) {
      setStart(iso);
      setEnd("");
    } else if (iso < start) {
      setEnd(start);
      setStart(iso);
    } else {
      setEnd(iso);
    }
  }
  function pickToday() {
    const t = toISODate(new Date());
    setStart(t);
    setEnd(t);
    setView((() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })());
  }
  function clear() {
    setStart("");
    setEnd("");
  }
  const shiftMonth = (dir: number) => {
    const d = new Date(view.y, view.m + dir, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const lo = start && end ? (start < end ? start : end) : start;
  const hi = start && end ? (start < end ? end : start) : start;

  const label = start ? (end && end !== start ? `${start} ~ ${end}` : start) : placeholder;

  return (
    <div style={{ position: "relative" }}>
      <input type="hidden" name={startName} value={start} />
      <input type="hidden" name={endName} value={end || start} />
      <button
        type="button"
        onClick={openCal}
        style={{
          width: "100%", height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8,
          background: "#fff", color: start ? "var(--text)" : "#9CA3AF", fontSize: 15, fontFamily: "inherit",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 8, textAlign: "left",
        }}
      >
        <span>📅</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{label}</span>
      </button>

      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: 48, left: 0, zIndex: 41, width: 300, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.16)", padding: 14 }}>
            {/* 빠른 선택(폼용): 오늘 하루만 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={pickToday} style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 999, background: "#F9FAFB", color: "var(--text-sub)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                오늘 하루
              </button>
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
                const isEndpoint = iso === start || iso === end;
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

            {/* 선택 요약 + 확인/지우기 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
                {start || "—"} ~ {end || start || "—"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {allowClear && (
                  <button type="button" onClick={clear} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                    지우기
                  </button>
                )}
                <button type="button" onClick={() => setOpen(false)} style={{ height: 32, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                  확인
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
