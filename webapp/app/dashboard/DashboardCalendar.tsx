// 대시보드용 이번 달 일정 캘린더 — 읽기전용(서버 컴포넌트). 클릭 등록은 [일정] 화면에서 한다.
//  · 법정공휴일(빨강)·회사 휴무일(보라)·회사 일정(막대)·오늘을 한눈에.
//  · 카드 우상단 "일정 관리 →"로 /schedule 진입.
import Link from "next/link";
import { toISODate } from "@/lib/period";
import type { DayData } from "@/app/schedule/ScheduleCalendar";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const EVENT_BG = "#2563EB";

export function DashboardCalendar({
  year,
  month, // 0-based
  byDate,
}: {
  year: number;
  month: number;
  byDate: Record<string, DayData>;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO = toISODate(new Date());
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>이번 달 일정 · {year}년 {month + 1}월</div>
        <Link href="/schedule" style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>일정 관리 →</Link>
      </div>

      <div style={{ padding: 14 }}>
        {/* 요일 헤더 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
          {WEEK.map((w, i) => (
            <div key={w} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, padding: "6px 0", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", color: i === 0 ? "#DC2626" : i === 6 ? "#2563EB" : "var(--text-sub)" }}>{w}</div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderLeft: "1px solid var(--border)" }}>
          {cells.map((d, idx) => {
            if (d === null) return <div key={`b${idx}`} style={{ borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "#FAFAFA", minHeight: 68 }} />;
            const iso = toISODate(new Date(year, month, d));
            const dow = (firstWeekday + d - 1) % 7;
            const data = byDate[iso];
            const isToday = iso === todayISO;
            const dayColor = data?.nationalHoliday || data?.companyHoliday || dow === 0 ? "#DC2626" : dow === 6 ? "#2563EB" : "var(--text)";
            const shown = data?.events?.slice(0, 2) ?? [];
            const more = (data?.events?.length ?? 0) - shown.length;

            return (
              <div key={d} style={{ borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: isToday ? "#FFFBEB" : "#fff", minHeight: 68, padding: 4, display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: dayColor, fontVariantNumeric: "tabular-nums" }}>{d}</span>
                {data?.nationalHoliday && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#DC2626", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.nationalHoliday}</span>
                )}
                {data?.companyHoliday && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#6D28D9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>휴무</span>
                )}
                {shown.map((ev) => (
                  <span key={ev.id} style={{ fontSize: 10, fontWeight: 600, color: "#fff", background: ev.color || EVENT_BG, borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.title}</span>
                ))}
                {more > 0 && <span style={{ fontSize: 9, color: "var(--text-sub)", fontWeight: 700 }}>+{more}</span>}
              </div>
            );
          })}
        </div>

        {/* 범례 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12, fontSize: 11, color: "var(--text-sub)" }}>
          <Legend color="#DC2626" label="공휴일" />
          <Legend color="#6D28D9" label="휴무일" />
          <Legend color={EVENT_BG} label="일정" />
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}
