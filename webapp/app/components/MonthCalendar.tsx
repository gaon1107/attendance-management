// 월간 캘린더 — 내 근태를 달력으로 본다. 날짜별 상태(출근·휴가·결근·지각·휴일근무)를 색으로 표시.
// 계산은 buildDayEntries가 만든 DayEntry[]를 그대로 재사용한다(표 화면과 같은 데이터).
import { formatMinutes } from "@/lib/worktime";
import { toISODate } from "@/lib/period";
import type { DayEntry } from "@/lib/dayentries";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function MonthCalendar({
  year,
  month, // 0-based (0=1월)
  entries,
}: {
  year: number;
  month: number;
  entries: DayEntry[];
}) {
  // 날짜(ISO) → 그 날의 대표 항목. (같은 날 여러 출근 기록이면 먼저 온 것 유지)
  const byDate = new Map<string, DayEntry>();
  for (const e of entries) {
    const iso = toISODate(e.date);
    if (!byDate.has(iso)) byDate.set(iso, e);
  }

  const firstWeekday = new Date(year, month, 1).getDay(); // 0=일
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO = toISODate(new Date());

  // 셀 목록(앞 빈칸 + 날짜들)
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const headStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, textAlign: "center", padding: "8px 0", color: "var(--text-sub)" };

  return (
    <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      {/* 요일 헤더 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {WEEK.map((w, i) => (
          <div key={w} style={{ ...headStyle, color: i === 0 ? "#DC2626" : i === 6 ? "#2563EB" : "var(--text-sub)" }}>{w}</div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, idx) => {
          if (d === null) return <div key={`b${idx}`} />;
          const iso = toISODate(new Date(year, month, d));
          const e = byDate.get(iso);
          const dow = (firstWeekday + d - 1) % 7;
          const isToday = iso === todayISO;

          // 상태별 배경·라벨
          let bg = "transparent";
          let badge: { text: string; color: string } | null = null;
          let sub: string | null = null;
          if (e?.type === "att") {
            bg = "#F0FDF4";
            sub = formatMinutes(e.minutes);
            if (e.holiday) badge = { text: "휴일", color: "#6D28D9" };
            else if (e.approvedLeave) {
              // 승인 반차/조퇴가 있어도 그날 "면제 안 된" 지각/조퇴가 남아 있으면 함께 표기(예: 오전 반차인데 무단 조퇴).
              const extra = [e.late ? "지각" : "", e.early ? "조퇴" : ""].filter(Boolean).join("·");
              badge = extra ? { text: `${e.approvedLeave}·${extra}`, color: "#C2410C" } : { text: e.approvedLeave, color: "#2563EB" };
            } else if (e.late && e.early) badge = { text: "지각·조퇴", color: "#C2410C" };
            else if (e.late) badge = { text: "지각", color: "#B45309" };
            else if (e.early) badge = { text: "조퇴", color: "#C2410C" };
            else badge = { text: "출근", color: "#15803D" };
          } else if (e?.type === "leave") {
            bg = "#EFF6FF";
            badge = { text: "휴가", color: "#2563EB" };
          } else if (e?.type === "absent") {
            bg = "#FEF2F2";
            badge = { text: "결근", color: "#DC2626" };
          }

          const dayColor = dow === 0 ? "#DC2626" : dow === 6 ? "#2563EB" : "var(--text)";

          return (
            <div
              key={d}
              style={{
                minHeight: 62,
                border: isToday ? "2px solid var(--primary)" : "1px solid var(--border)",
                borderRadius: 8,
                background: bg,
                padding: "6px 6px 4px",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                overflow: "hidden",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: dayColor, fontVariantNumeric: "tabular-nums" }}>{d}</div>
              {badge && (
                <span style={{ fontSize: 11, fontWeight: 700, color: badge.color, whiteSpace: "nowrap" }}>{badge.text}</span>
              )}
              {sub && (
                <span style={{ fontSize: 11, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{sub}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* 범례 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14, fontSize: 12, color: "var(--text-sub)" }}>
        <Legend color="#15803D" label="출근" />
        <Legend color="#B45309" label="지각" />
        <Legend color="#C2410C" label="조퇴" />
        <Legend color="#2563EB" label="휴가" />
        <Legend color="#DC2626" label="결근" />
        <Legend color="#6D28D9" label="휴일근무" />
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
