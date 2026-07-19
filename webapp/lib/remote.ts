// 재택근무 신청 — 상태 라벨의 단일 출처. (휴가 lib/leave.ts의 축소판)
//  · 승인은 "허가 기록"만 남긴다 — 근태/실근무 판정 로직과 무관(사장님 결정 2026-07-20).

export function remoteStatusLabel(status: string): string {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "대기";
}

// 한 번에 신청 가능한 최대 기간(일). 재택은 잔량 개념이 없어 무제한 방지용 상한을 둔다.
export const MAX_REMOTE_DAYS = 366;

// 기간 라벨 — 시작·종료 연도가 다르면 연도를 붙여 다년/크로스이어 신청을 정확히 표시한다.
//  (연도 생략 시 "2026-07-20 ~ 2027-07-20"이 "07/20" 하루로 보이는 오판 방지. 결재자 표시의 단일 출처.)
export function remoteRangeLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const opt: Intl.DateTimeFormatOptions = sameYear
    ? { month: "2-digit", day: "2-digit" }
    : { year: "numeric", month: "2-digit", day: "2-digit" };
  const s = start.toLocaleDateString("ko-KR", opt);
  const e = end.toLocaleDateString("ko-KR", opt);
  const sameDay = sameYear && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  return sameDay ? s : `${s} ~ ${e}`;
}
