// 공통 통합검색 필터 — 여러 단어를 공백/쉼표로 나눠 OR(하나라도 포함) 매칭한다.
//  · 대소문자 무시(소문자 비교). 한글은 영향 없음.
//  · 처음 개발: 근태현황 통합검색(2026-07). 표준 로직으로 승격.

// 검색어 문자열 → 소문자 단어 배열(공백/쉼표 구분, 빈 항목 제거).
export function queryTerms(q: string): string[] {
  return q.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
}

// text가 terms 중 하나라도 포함하면 true. terms가 비면(검색 안 함) 항상 true.
export function matchesTerms(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = text.toLowerCase();
  return terms.some((t) => hay.includes(t));
}

// 목록을 검색어로 거른다. getText(item)이 그 항목의 "검색 대상 문자열"을 돌려준다.
export function filterByQuery<T>(items: T[], q: string, getText: (item: T) => string): T[] {
  const terms = queryTerms(q);
  if (terms.length === 0) return items;
  return items.filter((it) => matchesTerms(getText(it), terms));
}
