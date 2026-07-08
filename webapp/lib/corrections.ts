// 근태 정정 요청 도구 — 시각 검증 + 날짜+시각 → Date 조립 + 상태 라벨.

// "HH:MM"(24시간) 형식이 맞는지 확인.
export function isValidHm(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// 대상 날짜(자정 Date) + "HH:MM" → 그 날 그 시각의 Date.
export function hmToDate(date: Date, hm: string): Date {
  const [h, m] = hm.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
}

export function correctionStatusLabel(status: string): string {
  if (status === "approved") return "승인·반영됨";
  if (status === "rejected") return "반려";
  return "대기";
}
