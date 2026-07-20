// 초과근무(야근) 사전신청 — 상태 라벨·시각 헬퍼의 단일 출처.
//  · 승인은 "허가 기록"만 — 기존 주52 감지·실근무 계산과 무관(사장님 결정 2026-07-20).
//  · 기존 lib/overtime.ts(주52 계산)와 다른 파일 — 이름 충돌 방지.

export function overtimeStatusLabel(status: string): string {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "대기";
}

// "HH:MM" 형식 검사(00:00~23:59).
export function isValidHm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// 야근 시간대 라벨 — 종료가 시작 이하이면 자정을 넘긴 것으로 보고 "익일"을 붙인다.
//  (예: 22:00~02:00 → "22:00 ~ 익일 02:00"). 표시 전용, 판정에는 쓰지 않는다.
export function overtimeTimeLabel(startTime: string, endTime: string): string {
  const nextDay = endTime <= startTime;
  return `${startTime} ~ ${nextDay ? "익일 " : ""}${endTime}`;
}
