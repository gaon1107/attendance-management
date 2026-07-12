// 근태 상세(직원별/내근태)용 계산 — 출퇴근 기록 + 결근(과거 근무일 무기록)을 날짜별로 합치고 집계한다.
import { workedMinutes, isLate } from "@/lib/worktime";
import { toISODate } from "@/lib/period";
import { effectiveWorkDays, isWorkDay } from "@/lib/workdays";

type BreakLike = { startAt: Date; endAt: Date | null; reason: string };
// 출퇴근 촬영 사진·판독 기록(관리자 근태 상세 전용). 조회하지 않은 화면(내근태 등)에서는 undefined — 기존 동작 무변경.
export type ClockPhotoLite = {
  id: string;
  kind: string; // "in" | "out"
  livenessStatus: string; // "ok" | "suspect" | "error"
  livenessScore: number | null;
  fileDeletedAt: Date | null;
};
export type AttRow = {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
  workMode: string;
  locationStatus: string | null;
  breaks: BreakLike[];
  clockPhotos?: ClockPhotoLite[];
};
type Company = { workStartTime: string | null; lateGraceMin: number; workDays: string } | null;

export type DayEntry =
  | { type: "att"; date: Date; rec: AttRow; holiday: boolean; late: boolean | null; minutes: number }
  | { type: "absent"; date: Date }
  | { type: "leave"; date: Date; label: string };

export type DayDetail = {
  entries: DayEntry[]; // 날짜 내림차순(출퇴근 기록 + 결근 + 휴가)
  totalMinutes: number;
  days: number; // 출근한 날 수
  lateCount: number;
  absentCount: number; // 결근 일수
  leaveDaysCount: number; // 이 기간에 휴가로 처리된 근무일 수
  hasRule: boolean; // 근무 기준시각이 설정돼 있는가(지각 판정 가능 여부)
};

// rows: 기간 내 출퇴근 기록. start/end: 조회 기간(end 미포함).
// leaveByDate: 승인된 휴가일(ISO) → 종류 라벨. 이 날은 결근이 아니라 "휴가"로 처리한다.
export function buildDayEntries(
  rows: AttRow[],
  userWorkDays: string | null,
  company: Company,
  start: Date,
  end: Date,
  leaveByDate: Map<string, string> = new Map()
): DayDetail {
  const wd = effectiveWorkDays(userWorkDays, company?.workDays);
  const hasRule = !!company?.workStartTime;

  const attEntries: DayEntry[] = rows.map((r) => {
    const onWorkDay = isWorkDay(r.clockIn, wd);
    const late = onWorkDay ? isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0) : null;
    return { type: "att", date: r.clockIn, rec: r, holiday: !onWorkDay, late, minutes: workedMinutes(r) };
  });

  // 결근 = 과거(오늘 이전) 근무일 중 출근 기록이 없는 날. 단, 승인된 휴가일은 결근이 아니라 "휴가".
  // 오늘·미래는 아직 결근 아님.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const attendedISO = new Set(rows.map((r) => toISODate(r.clockIn)));
  const limit = end < startOfToday ? end : startOfToday;
  const extraEntries: DayEntry[] = [];
  let absentCount = 0;
  let leaveDaysCount = 0;
  for (let cur = new Date(start); cur < limit; cur = new Date(cur.getTime() + 86400000)) {
    const iso = toISODate(cur);
    if (attendedISO.has(iso)) continue; // 출근한 날은 위 attEntries에 있음
    if (leaveByDate.has(iso) && isWorkDay(cur, wd)) {
      extraEntries.push({ type: "leave", date: new Date(cur), label: leaveByDate.get(iso)! });
      leaveDaysCount++;
    } else if (isWorkDay(cur, wd)) {
      extraEntries.push({ type: "absent", date: new Date(cur) });
      absentCount++;
    }
  }

  const entries = [...attEntries, ...extraEntries].sort((a, b) => b.date.getTime() - a.date.getTime());
  const totalMinutes = attEntries.reduce((s, e) => s + (e.type === "att" ? e.minutes : 0), 0);
  const days = new Set(rows.map((r) => toISODate(r.clockIn))).size;
  const lateCount = attEntries.filter((e) => e.type === "att" && e.late === true).length;

  return { entries, totalMinutes, days, lateCount, absentCount, leaveDaysCount, hasRule };
}
