// 휴가 계산 도구 — 종류·사용일수·잔여, 그리고 "승인된 휴가일"을 결근 판정에서 빼기 위한 날짜 집합.
import { toISODate } from "@/lib/period";
import { isWorkDay } from "@/lib/workdays";

// 휴가 종류. deducts=true면 연차 잔여에서 차감(연차·반차). 병가는 차감하지 않는다.
export const LEAVE_TYPES: { key: string; label: string; deducts: boolean }[] = [
  { key: "annual", label: "연차", deducts: true },
  { key: "half", label: "반차(반일)", deducts: true },
  { key: "sick", label: "병가", deducts: false },
];

export function leaveTypeLabel(type: string): string {
  return LEAVE_TYPES.find((t) => t.key === type)?.label ?? type;
}

export function leaveTypeDeducts(type: string): boolean {
  return LEAVE_TYPES.find((t) => t.key === type)?.deducts ?? false;
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
export function countWorkdaysBetween(start: Date, end: Date, workDays: Set<number>): number {
  let n = 0;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    if (isWorkDay(cur, workDays)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

// 신청 시 사용일수 계산. 반차=0.5(단일일), 연차·병가=기간 내 근무일 수.
export function computeLeaveDays(type: string, start: Date, end: Date, workDays: Set<number>): number {
  if (type === "half") return 0.5;
  return countWorkdaysBetween(start, end, workDays);
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

// 승인된 휴가들을 "덮인 날짜(ISO)" 집합으로 펼친다. 결근/미출근 판정에서 이 날짜를 제외한다.
type LeaveRange = { startDate: Date; endDate: Date };
export function leaveDateSet(approved: LeaveRange[]): Set<string> {
  const set = new Set<string>();
  for (const lv of approved) {
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
