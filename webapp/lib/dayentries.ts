// 근태 상세(직원별/내근태)용 계산 — 출퇴근 기록 + 결근(과거 근무일 무기록)을 날짜별로 합치고 집계한다.
import { workedMinutes, isLate, isEarlyLeave } from "@/lib/worktime";
import { toISODate } from "@/lib/period";
import { effectiveWorkDays, isEffectiveWorkDay } from "@/lib/workdays";
import { leaveTypeLabel, leaveSuppressesLate, leaveSuppressesEarly } from "@/lib/leave";
import { judgeByShift, type ResolvedShift } from "@/lib/shift";

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
type Company = { workStartTime: string | null; workEndTime: string | null; lateGraceMin: number; workDays: string } | null;

export type DayEntry =
  // approvedLeave: 그날 승인된 반차/조퇴 라벨(있으면 지각·조퇴 대신 이 뱃지를 보여줌). 없으면 null.
  | { type: "att"; date: Date; rec: AttRow; holiday: boolean; late: boolean | null; early: boolean | null; approvedLeave: string | null; minutes: number }
  | { type: "absent"; date: Date }
  | { type: "leave"; date: Date; label: string };

export type DayDetail = {
  entries: DayEntry[]; // 날짜 내림차순(출퇴근 기록 + 결근 + 휴가)
  totalMinutes: number;
  days: number; // 출근한 날 수
  lateCount: number;
  earlyLeaveCount: number; // 조퇴 건수
  absentCount: number; // 결근 일수
  leaveDaysCount: number; // 이 기간에 휴가로 처리된 근무일 수
  hasRule: boolean; // 출근 기준시각이 설정돼 있는가(지각 판정 가능 여부)
  hasEndRule: boolean; // 퇴근 기준시각이 설정돼 있는가(조퇴 판정 가능 여부)
};

// rows: 기간 내 출퇴근 기록. start/end: 조회 기간(end 미포함).
// leaveByDate: 승인된 휴가일(ISO) → 종류 라벨. 이 날은 결근이 아니라 "휴가"로 처리한다.
// offDays: 쉬는 날(공휴일·회사휴무일) ISO 집합. 안 넘기면(기본 빈 Set) 요일만으로 판정 = 기존 동작.
export function buildDayEntries(
  rows: AttRow[],
  userWorkDays: string | null,
  company: Company,
  start: Date,
  end: Date,
  leaveByDate: Map<string, string> = new Map(),
  offDays: Set<string> = new Set(),
  // 승인된 반차/조퇴 종류맵(날짜 ISO → 종류 key). 출근한 날 지각·조퇴를 면제하는 데 쓴다. 안 넘기면 면제 없음(기존 동작).
  leaveTypeByDate: Map<string, string> = new Map(),
  // [교대제] 그날 그 직원의 조를 돌려주는 해석기(휴무=null). 넘기면 지각/조퇴/결근을 조 기준으로 판정한다.
  //  안 넘기면(비교대) 아래 로직 전부 기존 그대로 = 회귀 0. (호출부가 loadShiftContext+resolveShift로 만든다)
  shiftResolver?: (dateISO: string) => ResolvedShift | null
): DayDetail {
  const wd = effectiveWorkDays(userWorkDays, company?.workDays);
  // 교대제면 조가 시각을 정하므로 지각·조퇴 판정이 항상 가능. 비교대면 회사 기준시각 유무.
  const hasRule = shiftResolver ? true : !!company?.workStartTime;
  const hasEndRule = shiftResolver ? true : !!company?.workEndTime;
  // 그날 근무예정일인가 — 근무요일 + 쉬는날(공휴일·회사휴무일) 제외는 교대·비교대 공통.
  //  교대제는 추가로 그날 조 배정(≠휴무)까지 있어야 근무예정(주말·공휴일 결근 오판 방지). 결근·게이팅 공통 기준.
  const isWorkDay = (d: Date, iso: string): boolean =>
    isEffectiveWorkDay(d, wd, offDays) && (!shiftResolver || shiftResolver(iso) !== null);

  const attEntries: DayEntry[] = rows.map((r) => {
    const iso = toISODate(r.clockIn);
    const shift = shiftResolver ? shiftResolver(iso) : undefined; // undefined=비교대, null=교대제 휴무
    const workday = isEffectiveWorkDay(r.clockIn, wd, offDays); // 근무요일 + 쉬는날 제외
    const onWorkDay = shiftResolver ? workday && shift !== null : workday;
    let late: boolean | null;
    let early: boolean | null;
    if (shiftResolver) {
      // 교대제: 근무일 + 그날 조 있으면 자정 넘김까지 정확 판정. 휴무·공휴일·주말이면 판정 안 함(=휴일근무).
      if (workday && shift) {
        const j = judgeByShift(r.clockIn, r.clockOut, iso, shift, company?.lateGraceMin ?? 0);
        late = j.late; early = j.early;
      } else { late = null; early = null; }
    } else {
      late = onWorkDay ? isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0) : null;
      // 조퇴도 지각과 동일 게이팅: 근무일에만. 퇴근기록 없음(근무중)·기준시각 미설정은 isEarlyLeave가 null 반환.
      early = onWorkDay ? isEarlyLeave(r.clockOut, company?.workEndTime ?? null) : null;
    }
    // 승인된 반차/조퇴가 있으면 해당 자동판정을 면제(null)하고, 승인 뱃지 라벨을 남긴다.
    const lt = leaveTypeByDate.get(iso);
    if (lt && leaveSuppressesLate(lt)) late = null;
    if (lt && leaveSuppressesEarly(lt)) early = null;
    const approvedLeave = lt ? leaveTypeLabel(lt) : null;
    return { type: "att", date: r.clockIn, rec: r, holiday: !onWorkDay, late, early, approvedLeave, minutes: workedMinutes(r) };
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
    if (leaveByDate.has(iso) && isWorkDay(cur, iso)) {
      extraEntries.push({ type: "leave", date: new Date(cur), label: leaveByDate.get(iso)! });
      leaveDaysCount++;
    } else if (isWorkDay(cur, iso)) {
      extraEntries.push({ type: "absent", date: new Date(cur) });
      absentCount++;
    }
  }

  const entries = [...attEntries, ...extraEntries].sort((a, b) => b.date.getTime() - a.date.getTime());
  const totalMinutes = attEntries.reduce((s, e) => s + (e.type === "att" ? e.minutes : 0), 0);
  const days = new Set(rows.map((r) => toISODate(r.clockIn))).size;
  const lateCount = attEntries.filter((e) => e.type === "att" && e.late === true).length;
  const earlyLeaveCount = attEntries.filter((e) => e.type === "att" && e.early === true).length;

  return { entries, totalMinutes, days, lateCount, earlyLeaveCount, absentCount, leaveDaysCount, hasRule, hasEndRule };
}
