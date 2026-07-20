// 출장 신청 — 상태 라벨·기간 라벨의 단일 출처.
//  · 승인은 "허가 기록"만 남긴다 — 근태/실근무 판정 로직과 무관.

export function tripStatusLabel(status: string): string {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "대기";
}

// 한 번에 신청 가능한 최대 출장 기간(일). 무제한 방지용 상한.
export const MAX_TRIP_DAYS = 366;

// 기간 라벨 — 시작·종료 연도가 다르면 연도를 붙여 다년/크로스이어를 정확히 표시(재택 remoteRangeLabel과 동일 정책).
export function tripRangeLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const opt: Intl.DateTimeFormatOptions = sameYear
    ? { month: "2-digit", day: "2-digit" }
    : { year: "numeric", month: "2-digit", day: "2-digit" };
  const s = start.toLocaleDateString("ko-KR", opt);
  const e = end.toLocaleDateString("ko-KR", opt);
  const sameDay = sameYear && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  return sameDay ? s : `${s} ~ ${e}`;
}
