"use client";
// 공통 단일 날짜 선택기 — RangeCalendar와 동일한 커스텀 달력 팝업(브라우저 기본 달력 대신).
//  · 폼에서 "하루" 날짜를 고를 때 쓴다. 값은 "YYYY-MM-DD"(비었으면 "").
//  · 서버로는 내부 hidden input(name)으로 제출되므로, 기존 폼(FormData)이 그대로 동작한다.
//  · 기간(시작~종료) 선택은 RangeCalendar를 쓴다. 이 컴포넌트는 단일 날짜 전용.
import { useEffect, useState } from "react";
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

export function DatePicker({
  name,
  defaultValue = "",
  placeholder = "날짜 선택",
  allowClear = true,
  onChange,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  allowClear?: boolean;
  onChange?: (iso: string) => void;
}) {
  const [value, setValue] = useState(isYmd(defaultValue) ? defaultValue : "");
  const [open, setOpen] = useState(false);
  const [todayISO, setTodayISO] = useState(""); // 오늘 표시는 마운트 후(서버/클라 시각차로 인한 hydration 경고 방지)
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    if (isYmd(defaultValue)) {
      const [y, m] = defaultValue.split("-").map(Number);
      return { y, m: m - 1 };
    }
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  useEffect(() => {
    setTodayISO(toISODate(new Date()));
  }, []);

  function openCal() {
    if (isYmd(value)) {
      const [y, m] = value.split("-").map(Number);
      setView({ y, m: m - 1 });
    }
    setOpen(true);
  }
  function choose(iso: string) {
    setValue(iso);
    onChange?.(iso);
    setOpen(false);
  }
  function pickToday() {
    const t = toISODate(new Date());
    choose(t);
  }
  function clear() {
    setValue("");
    onChange?.("");
    setOpen(false);
  }
  const shiftMonth = (dir: number) => {
    const d = new Date(view.y, view.m + dir, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div style={{ position: "relative" }}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={openCal}
        style={{
          width: "100%", height: 44, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8,
          background: "#fff", color: value ? "var(--text)" : "#9CA3AF", fontSize: 15, fontFamily: "inherit",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 8, textAlign: "left",
        }}
      >
        <span>📅</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{value || placeholder}</span>
      </button>

      {open && (
        <>
          {/* 바깥 클릭 시 닫힘 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: 48, left: 0, zIndex: 41, width: 300, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.16)", padding: 14 }}>
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
                const isSelected = iso === value;
                const isToday = iso === todayISO;
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => choose(iso)}
                    style={{
                      height: 34, border: "none", borderRadius: 8, cursor: "pointer",
                      fontSize: 13, fontWeight: isSelected ? 800 : 600, fontFamily: "inherit",
                      background: isSelected ? "var(--primary)" : "transparent",
                      color: isSelected ? "#fff" : "var(--text)",
                      outline: isToday && !isSelected ? "1px solid var(--primary)" : "none",
                      outlineOffset: -1,
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>

            {/* 하단: 지우기 / 오늘 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
              {allowClear ? (
                <button type="button" onClick={clear} style={{ height: 32, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                  지우기
                </button>
              ) : (
                <span />
              )}
              <button type="button" onClick={pickToday} style={{ height: 32, padding: "0 16px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                오늘
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
