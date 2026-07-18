// 휴가 계산 도구 — 종류·사용일수·잔여, 그리고 "승인된 휴가일"을 결근 판정에서 빼기 위한 날짜 집합.
import { toISODate } from "@/lib/period";
import { isEffectiveWorkDay } from "@/lib/workdays";

// 휴가/근태 종류. deducts=true면 연차 잔여에서 차감(연차·반차). 병가·조퇴는 차감하지 않는다.
//  · half_am(오전 반차): 오전에 쉬고 오후 출근 → 그날 "지각" 면제
//  · half_pm(오후 반차): 오전 근무 후 오후에 쉼(일찍 퇴근) → 그날 "조퇴" 면제
//  · early_leave(조퇴): 승인된 조기 퇴근 → "조퇴" 면제, 연차 차감 없음
//  · half(레거시): 과거 "반차" 데이터 호환용(신규 신청 불가). 면제 시 지각·조퇴 둘 다 면제.
export const LEAVE_TYPES: { key: string; label: string; deducts: boolean }[] = [
  { key: "annual", label: "연차", deducts: true },
  { key: "half_am", label: "오전 반차", deducts: true },
  { key: "half_pm", label: "오후 반차", deducts: true },
  { key: "early_leave", label: "조퇴", deducts: false },
  { key: "sick", label: "병가", deducts: false },
  { key: "half", label: "반차", deducts: true }, // 레거시(과거 데이터 라벨용, 신규 신청 목록 제외)
];

// 직원이 새로 신청할 수 있는 종류(드롭다운). 레거시 half는 제외한다.
export const REQUESTABLE_TYPES = ["annual", "half_am", "half_pm", "early_leave", "sick"] as const;

// 하루짜리(종료일 없음) 종류 — 반차·병가·조퇴. 연차만 기간(시작~종료).
export const SINGLE_DAY_TYPES = ["half", "half_am", "half_pm", "sick", "early_leave"] as const;

export function isSingleDayLeave(type: string): boolean {
  return (SINGLE_DAY_TYPES as readonly string[]).includes(type);
}

export function leaveTypeLabel(type: string): string {
  return LEAVE_TYPES.find((t) => t.key === type)?.label ?? type;
}

export function leaveTypeDeducts(type: string): boolean {
  return LEAVE_TYPES.find((t) => t.key === type)?.deducts ?? false;
}

// [근태 면제 규칙] 승인된 이 종류가 그날의 "지각"/"조퇴" 자동판정을 면제하는가.
//  · 오전 반차 = 늦게 출근 정당 → 지각 면제.  · 오후 반차·조퇴 = 일찍 퇴근 정당 → 조퇴 면제.
//  · 종일 휴가(연차·병가·레거시 반차)를 쓴 날에 예외적으로 출근했다면 지각·조퇴 둘 다 면제(안전).
export function leaveSuppressesLate(type: string): boolean {
  return type === "half_am" || type === "half" || type === "annual" || type === "sick";
}
export function leaveSuppressesEarly(type: string): boolean {
  return type === "half_pm" || type === "early_leave" || type === "half" || type === "annual" || type === "sick";
}

export function leaveStatusLabel(status: string): string {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "대기";
}

// "YYYY-MM-DD" → 그 지역시간 자정 Date. (new Date("...")는 UTC로 읽혀 날짜가 밀릴 수 있어 직접 만든다)
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

// [start, end] 사이(포함)의 근무일 수. 근무요일(Set)만 센다.
// offDays(쉬는 날 ISO 집합)를 넘기면 공휴일·회사휴무일은 근무일에서 제외한다. 안 넘기면(기본 빈 Set) 기존 동작.
export function countWorkdaysBetween(start: Date, end: Date, workDays: Set<number>, offDays: Set<string> = new Set()): number {
  let n = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    if (isEffectiveWorkDay(cur, workDays, offDays)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

// 신청 시 사용일수 계산. 조퇴=0(차감 없음), 반차(반일)=0.5, 연차·병가=기간 내 근무일 수(공휴일·회사휴무일 제외).
export function computeLeaveDays(type: string, start: Date, end: Date, workDays: Set<number>, offDays: Set<string> = new Set()): number {
  if (type === "early_leave") return 0; // 조퇴는 연차 차감 없음
  if (type === "half" || type === "half_am" || type === "half_pm") return 0.5;
  return countWorkdaysBetween(start, end, workDays, offDays);
}

// 승인된 신청들 중 연차 잔여에서 차감되는 사용일수 합(연차·반차). 병가는 제외.
type LeaveUse = { type: string; days: number; status: string };
export function usedLeaveDays(requests: LeaveUse[]): number {
  return requests
    .filter((r) => r.status === "approved" && leaveTypeDeducts(r.type))
    .reduce((s, r) => s + r.days, 0);
}

// 특정 연도에 "시작하는" 승인된 연차·반차 사용일수 합. (연차 정산 화면 — 연도별 사용량)
// 기간이 연말을 넘는 휴가는 시작일 연도로 귀속한다(간소형 기준).
type LeaveUseDated = { type: string; days: number; status: string; startDate: Date };
export function usedLeaveDaysInYear(requests: LeaveUseDated[], year: number): number {
  return requests
    .filter((r) => r.status === "approved" && leaveTypeDeducts(r.type) && r.startDate.getFullYear() === year)
    .reduce((s, r) => s + r.days, 0);
}

// ── B-2 연차 자동발생 (입사일 기준·간소) ──────────────────────────────
// [내부] 입사일부터 기준일까지 "완전히 지난 개월 수". 기념일 당일은 그 달을 채운 것으로 본다.
//   예) 1/15 입사 → 이듬해 1/15 = 12개월(=1년), 1/14 = 11개월. 입사일이 미래면 음수→0으로 막는다.
function fullMonthsBetween(hire: Date, asOf: Date): number {
  let months = (asOf.getFullYear() - hire.getFullYear()) * 12 + (asOf.getMonth() - hire.getMonth());
  if (asOf.getDate() < hire.getDate()) months -= 1; // 기념일(일자) 전이면 그 달은 아직 안 채움
  return months;
}

// [순수함수] 입사일 기준 자동 발생 연차(근로기준법 제60조·간소형).
//  · 입사일 없음 → 15(안전 기본값, 화면에서 "입사일 입력 시 정확 계산" 안내).
//  · 1년 미만 → 1개월당 1일(개근 가정), 최대 11.
//  · 1년 이상 → 15일. 3년 이상이면 (근속연수−1)/2 내림만큼 가산, 상한 25.
//  ※ 개근·80% 출근율은 "충족 가정"(간소 결정). 예외는 관리자 수동조정(override)으로 처리.
export function grantedAnnualLeave(hireDate: Date | null | undefined, asOf: Date = new Date()): number {
  if (!hireDate) return 15;
  const months = fullMonthsBetween(hireDate, asOf);
  if (months < 12) return Math.max(0, Math.min(months, 11));
  const years = Math.floor(months / 12);
  let base = 15;
  if (years >= 3) base += Math.floor((years - 1) / 2);
  return Math.min(base, 25);
}

// [헬퍼] "발생(부여) 연차"를 읽는 모든 화면이 공통으로 부른다(숫자 불일치 방지).
//   override(관리자 수동값)가 있으면 그 값, 없으면(null) 입사일 기준 자동계산.
export function annualLeaveGranted(
  user: { hireDate: Date | null; annualLeaveOverride: number | null },
  asOf: Date = new Date()
): number {
  return user.annualLeaveOverride ?? grantedAnnualLeave(user.hireDate, asOf);
}

// 승인된 휴가들을 "덮인 날짜(ISO)" 집합으로 펼친다. 결근/미출근 판정에서 이 날짜를 제외한다.
type LeaveRange = { type?: string; startDate: Date; endDate: Date };
export function leaveDateSet(approved: LeaveRange[]): Set<string> {
  const set = new Set<string>();
  for (const lv of approved) {
    if (lv.type === "early_leave") continue; // 조퇴는 하루 휴가가 아님 → 결근 제외 대상에서 빼야 무단결근이 안 숨는다
    const cur = new Date(lv.startDate.getFullYear(), lv.startDate.getMonth(), lv.startDate.getDate());
    const last = new Date(lv.endDate.getFullYear(), lv.endDate.getMonth(), lv.endDate.getDate());
    while (cur <= last) {
      set.add(toISODate(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }
  return set;
}

// 승인된 휴가들을 "날짜(ISO) → 종류 라벨" 맵으로 펼친다. 상세 표에서 "휴가 · 연차"처럼 보여주기 위함.
type LeaveTyped = { type: string; startDate: Date; endDate: Date };
export function leaveLabelByDate(approved: LeaveTyped[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const lv of approved) {
    if (lv.type === "early_leave") continue; // 조퇴는 하루 휴가가 아님 → "휴가일"로 표시하지 않는다(출근 없으면 결근으로 남음)
    const label = leaveTypeLabel(lv.type);
    const cur = new Date(lv.startDate.getFullYear(), lv.startDate.getMonth(), lv.startDate.getDate());
    const last = new Date(lv.endDate.getFullYear(), lv.endDate.getMonth(), lv.endDate.getDate());
    while (cur <= last) {
      map.set(toISODate(cur), label);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

// 승인된 휴가들을 "날짜(ISO) → 종류 key" 맵으로 펼친다. 출근한 날의 지각/조퇴 면제 판단에 쓴다.
//  · 같은 날 여러 승인이 겹치면 나중 것이 덮는다(실무상 드묾). 면제는 종류별로 leaveSuppressesLate/Early가 판단.
export function leaveTypeByDate(approved: LeaveTyped[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const lv of approved) {
    const cur = new Date(lv.startDate.getFullYear(), lv.startDate.getMonth(), lv.startDate.getDate());
    const last = new Date(lv.endDate.getFullYear(), lv.endDate.getMonth(), lv.endDate.getDate());
    while (cur <= last) {
      map.set(toISODate(cur), lv.type);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}
