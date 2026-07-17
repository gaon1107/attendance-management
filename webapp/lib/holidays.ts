// 휴일(공휴일·회사휴무일) 순수 로직 — DB·네트워크 없음(단위 테스트 가능).
// "쉬는 날"의 "YYYY-MM-DD" 집합을 만들어 근무일 판정(isEffectiveWorkDay)에 넘긴다.

// 저장된 휴일 한 건. date는 "YYYY-MM-DD".
export type HolidayLike = { date: string; name: string };

// 판정에 쓸 "쉬는 날 ISO 집합"을 만든다.
// - autoOn=true면 전국 공휴일(national)을 포함, false면 제외(공휴일에도 정상근무하는 회사 대비).
// - 회사 수동 휴무일(company)은 토글과 무관하게 항상 포함.
export function buildOffDays(
  national: HolidayLike[],
  company: HolidayLike[],
  autoOn: boolean
): Set<string> {
  const set = new Set<string>();
  if (autoOn) for (const h of national) set.add(h.date);
  for (const h of company) set.add(h.date);
  return set;
}

// 날짜(ISO) → 휴일 이름. 회사 지정이 전국 공휴일보다 우선(같은 날이면 회사 이름으로 덮어씀).
// 현재 화면은 "휴일근무" 배지만 쓰지만, 상세에 이름을 보여줄 때를 위해 함께 제공한다.
export function holidayNameMap(
  national: HolidayLike[],
  company: HolidayLike[],
  autoOn: boolean
): Map<string, string> {
  const map = new Map<string, string>();
  if (autoOn) for (const h of national) map.set(h.date, h.name);
  for (const h of company) map.set(h.date, h.name);
  return map;
}

// 정부 API의 locdate(예: 20260815 또는 "20260815") → "2026-08-15". 형식이 아니면 null.
export function locdateToIso(locdate: string | number): string | null {
  const s = String(locdate).trim();
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
