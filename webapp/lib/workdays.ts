// 근무요일 헬퍼 — 회사 기본 근무요일 + 직원별 예외를 다룬다.
// 요일 번호는 JS Date.getDay() 기준: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토.

export const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"]; // index = getDay()
// 화면에 보여줄 요일 순서(월요일부터)
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// CSV "1,2,3,4,5" → Set<number>
export function parseDays(csv: string | null | undefined): Set<number> {
  if (!csv) return new Set();
  return new Set(
    csv.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  );
}

// Set<number> → CSV "1,2,3,4,5" (월요일부터 정렬)
export function daysToCsv(days: Set<number>): string {
  return WEEK_ORDER.filter((d) => days.has(d)).join(",");
}

// 직원 예외가 있으면 그것, 없으면 회사 기본
export function effectiveWorkDays(userDays: string | null | undefined, companyDays: string | null | undefined): Set<number> {
  return userDays ? parseDays(userDays) : parseDays(companyDays);
}

// 이 날짜가 근무일인가
export function isWorkDay(date: Date, workDays: Set<number>): boolean {
  return workDays.has(date.getDay());
}

// Set → "월·화·수·목·금" 같은 사람이 읽는 라벨
export function daysLabel(days: Set<number>): string {
  const picked = WEEK_ORDER.filter((d) => days.has(d)).map((d) => DAY_LABELS[d]);
  return picked.length ? picked.join("·") : "없음";
}
