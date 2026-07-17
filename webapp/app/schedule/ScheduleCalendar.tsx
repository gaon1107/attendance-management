"use client";
// 일정 캘린더(클라이언트) — 월 그리드 + 날짜 클릭 시 모달로 일정/휴무일 관리.
//  · 법정공휴일(빨강, 읽기전용) · 회사 휴무일(보라 배지) · 회사 일정(막대) 표시.
//  · 등록/삭제는 서버액션(addEvent/deleteEvent + 기존 add/deleteCompanyHoliday)으로. 저장 후 목록은 서버 재검증으로 갱신.
import { useActionState, useState } from "react";
import Link from "next/link";
import { addEvent, deleteEvent } from "@/app/actions/schedule";
import { addCompanyHoliday, deleteCompanyHoliday } from "@/app/actions/holidays";

export type DayData = {
  nationalHoliday?: string; // 법정공휴일 이름(읽기전용)
  companyHoliday?: { id: string; name: string }; // 회사 휴무일
  events: { id: string; title: string; color: string | null }[]; // 회사 일정
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const EVENT_BG = "#2563EB";

const navBtn: React.CSSProperties = {
  width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)",
  fontWeight: 700, cursor: "pointer", textDecoration: "none", fontSize: 15,
};

export function ScheduleCalendar({
  year, month, todayISO, byDate, prevYm, nextYm, todayYm,
}: {
  year: number; month: number; todayISO: string;
  byDate: Record<string, DayData>;
  prevYm: string; nextYm: string; todayYm: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      {/* 헤더: 안내 + 월 이동 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>일정 캘린더</div>
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4 }}>
          날짜를 클릭해 회사 일정을 등록하거나 그 날을 휴무일로 지정하세요. (법정공휴일은 빨간색으로 자동 표시됩니다)
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Link href={`/schedule?ym=${prevYm}`} style={navBtn}>‹</Link>
          <Link href={`/schedule?ym=${nextYm}`} style={navBtn}>›</Link>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{year}년 {month + 1}월</div>
        <Link href={`/schedule?ym=${todayYm}`} style={{ ...navBtn, width: "auto", padding: "0 14px", fontSize: 13 }}>오늘</Link>
      </div>

      {/* 요일 헤더 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
        {WEEK.map((w, i) => (
          <div key={w} style={{ textAlign: "center", fontSize: 13, fontWeight: 700, padding: "8px 0", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", color: i === 0 ? "#DC2626" : i === 6 ? "#2563EB" : "var(--text-sub)" }}>{w}</div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderLeft: "1px solid var(--border)" }}>
        {cells.map((d, idx) => {
          if (d === null) return <div key={`b${idx}`} style={{ borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "#FAFAFA", minHeight: 104 }} />;
          const iso = isoOf(year, month, d);
          const dow = (firstWeekday + d - 1) % 7;
          const data = byDate[iso];
          const isToday = iso === todayISO;
          // 공휴일·회사휴무일·일요일이면 빨강, 토요일이면 파랑, 그 외 기본색
          const dayColor = data?.nationalHoliday || data?.companyHoliday || dow === 0 ? "#DC2626" : dow === 6 ? "#2563EB" : "var(--text)";
          const shownEvents = data?.events?.slice(0, 3) ?? [];
          const moreCount = (data?.events?.length ?? 0) - shownEvents.length;

          return (
            <button
              key={d}
              type="button"
              onClick={() => setSelected(iso)}
              style={{
                borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                background: isToday ? "#FFFBEB" : "#fff",
                minHeight: 104, padding: 6, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                display: "flex", flexDirection: "column", gap: 3, overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: dayColor, fontVariantNumeric: "tabular-nums" }}>{d}</span>
                {isToday && <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309" }}>오늘</span>}
              </div>
              {data?.nationalHoliday && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.nationalHoliday}</span>
              )}
              {data?.companyHoliday && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6D28D9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>휴무 · {data.companyHoliday.name}</span>
              )}
              {shownEvents.map((ev) => (
                <span key={ev.id} style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: ev.color || EVENT_BG, borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ev.title}
                </span>
              ))}
              {moreCount > 0 && <span style={{ fontSize: 10, color: "var(--text-sub)", fontWeight: 700 }}>+{moreCount}건 더</span>}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14, fontSize: 12, color: "var(--text-sub)" }}>
        <Legend color="#DC2626" label="법정공휴일(자동)" />
        <Legend color="#6D28D9" label="회사 휴무일" />
        <Legend color={EVENT_BG} label="회사 일정" />
      </div>

      {selected && (
        <DayModal
          key={selected}
          iso={selected}
          data={byDate[selected]}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

// 하루 상세 모달 — 그 날 공휴일/휴무일/일정 관리.
function DayModal({ iso, data, onClose }: { iso: string; data: DayData | undefined; onClose: () => void }) {
  const [addEvState, addEvAction, addEvPending] = useActionState(addEvent, {});
  const [delEvState, delEvAction] = useActionState(deleteEvent, {});
  const [addHolState, addHolAction, addHolPending] = useActionState(addCompanyHoliday, {});
  const [delHolState, delHolAction] = useActionState(deleteCompanyHoliday, {});

  const [y, m, d] = iso.split("-").map(Number);
  const dow = WEEK[new Date(y, m - 1, d).getDay()];
  const events = data?.events ?? [];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 50 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 51, width: "min(440px, 92vw)", maxHeight: "86vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{y}. {m}. {d}. ({dow})</div>
          <button type="button" onClick={onClose} style={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", cursor: "pointer", fontSize: 16, fontWeight: 700 }}>✕</button>
        </div>

        {/* 법정공휴일(읽기전용) */}
        {data?.nationalHoliday && (
          <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
            법정공휴일 · {data.nationalHoliday} <span style={{ fontWeight: 400, color: "var(--text-sub)" }}>(자동, 해제 불가)</span>
          </div>
        )}

        {/* 회사 휴무일 지정/해제 */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>회사 휴무일 <span style={{ fontWeight: 400, color: "var(--text-sub)" }}>(지정하면 지각·결근 판정에서 제외)</span></div>
          {data?.companyHoliday ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#6D28D9", flex: 1 }}>휴무 · {data.companyHoliday.name}</span>
              <form action={delHolAction}>
                <input type="hidden" name="id" value={data.companyHoliday.id} />
                <button type="submit" style={{ height: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>휴무 해제</button>
              </form>
            </div>
          ) : (
            <form action={addHolAction} style={{ display: "flex", gap: 8 }}>
              <input type="hidden" name="date" value={iso} />
              <input name="name" defaultValue="휴무일" maxLength={50} style={{ flex: 1, height: 40, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
              <button type="submit" disabled={addHolPending} style={{ height: 40, padding: "0 16px", border: "none", borderRadius: 8, background: "#6D28D9", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: addHolPending ? "default" : "pointer", opacity: addHolPending ? 0.6 : 1, whiteSpace: "nowrap" }}>휴무 지정</button>
            </form>
          )}
          {addHolState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{addHolState.error}</div>}
          {delHolState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{delHolState.error}</div>}
        </div>

        {/* 회사 일정 */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>일정</div>
          {events.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 10 }}>등록된 일정이 없습니다.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {events.map((ev) => (
                <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: ev.color || EVENT_BG, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, flex: 1, wordBreak: "break-word" }}>{ev.title}</span>
                  <form action={delEvAction}>
                    <input type="hidden" name="id" value={ev.id} />
                    <button type="submit" style={{ height: 30, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>삭제</button>
                  </form>
                </div>
              ))}
            </div>
          )}
          <form action={addEvAction} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="date" value={iso} />
            <input name="title" required placeholder="일정 내용(예: 월례회의)" maxLength={100} style={{ flex: 1, height: 40, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, outline: "none" }} />
            <button type="submit" disabled={addEvPending} style={{ height: 40, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: addEvPending ? "default" : "pointer", opacity: addEvPending ? 0.6 : 1, whiteSpace: "nowrap" }}>추가</button>
          </form>
          {addEvState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{addEvState.error}</div>}
          {delEvState?.error && <div style={{ fontSize: 12, color: "var(--danger)", fontWeight: 700, marginTop: 6 }}>{delEvState.error}</div>}
        </div>
      </div>
    </>
  );
}
