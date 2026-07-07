// 근태 상세(직원별/내근태)용 계산 — 출퇴근 기록 + 결근(과거 근무일 무기록)을 날짜별로 합치고 집계한다.
import { workedMinutes, isLate } from "@/lib/worktime";
import { toISODate } from "@/lib/period";
import { effectiveWorkDays, isWorkDay } from "@/lib/workdays";

type BreakLike = { startAt: Date; endAt: Date | null };
export type AttRow = {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
  workMode: string;
  locationStatus: string | null;
  breaks: BreakLike[];
};
type Company = { workStartTime: string | null; lateGraceMin: number; workDays: string } | null;

export type DayEntry =
  | { type: "att"; date: Date; rec: AttRow; holiday: boolean; late: boolean | null; minutes: number }
  | { type: "absent"; date: Date };

export type DayDetail = {
  entries: DayEntry[]; // 날짜 내림차순(출퇴근 기록 + 결근)
  totalMinutes: number;
  days: number; // 출근한 날 수
  lateCount: number;
  absentCount: number; // 결근 일수
  hasRule: boolean; // 근무 기준시각이 설정돼 있는가(지각 판정 가능 여부)
};

// rows: 기간 내 출퇴근 기록. start/end: 조회 기간(end 미포함).
export function buildDayEntries(rows: AttRow[], userWorkDays: string | null, company: Company, start: Date, end: Date): DayDetail {
  const wd = effectiveWorkDays(userWorkDays, company?.workDays);
  const hasRule = !!company?.workStartTime;

  const attEntries: DayEntry[] = rows.map((r) => {
    const onWorkDay = isWorkDay(r.clockIn, wd);
    const late = onWorkDay ? isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0) : null;
    return { type: "att", date: r.clockIn, rec: r, holiday: !onWorkDay, late, minutes: workedMinutes(r) };
  });

  // 결근 = 과거(오늘 이전) 근무일 중 출근 기록이 없는 날. 오늘·미래는 아직 결근 아님.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const attendedISO = new Set(rows.map((r) => toISODate(r.clockIn)));
  const limit = end < startOfToday ? end : startOfToday;
  const absentEntries: DayEntry[] = [];
  for (let cur = new Date(start); cur < limit; cur = new Date(cur.getTime() + 86400000)) {
    if (isWorkDay(cur, wd) && !attendedISO.has(toISODate(cur))) {
      absentEntries.push({ type: "absent", date: new Date(cur) });
    }
  }

  const entries = [...attEntries, ...absentEntries].sort((a, b) => b.date.getTime() - a.date.getTime());
  const totalMinutes = attEntries.reduce((s, e) => s + (e.type === "att" ? e.minutes : 0), 0);
  const days = new Set(rows.map((r) => toISODate(r.clockIn))).size;
  const lateCount = attEntries.filter((e) => e.type === "att" && e.late === true).length;

  return { entries, totalMinutes, days, lateCount, absentCount: absentEntries.length, hasRule };
}
