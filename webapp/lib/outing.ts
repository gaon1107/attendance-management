// 외출/외근 신청 — 종류·상태 라벨의 단일 출처. (휴가 lib/leave.ts의 축소판)
//  · 승인은 "허가 기록"만 남긴다 — 근태/실근무 판정 로직과 무관(사장님 결정 2026-07-20).

// 신청 종류: 외출(개인용무 성격) | 외근(업무 성격). 신청 폼·목록 표시에 사용.
export const OUTING_KINDS = [
  { key: "outing", label: "외출" },
  { key: "field", label: "외근" },
] as const;

export const OUTING_KIND_KEYS = OUTING_KINDS.map((k) => k.key) as readonly string[];

export function outingKindLabel(kind: string): string {
  return OUTING_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

export function outingStatusLabel(status: string): string {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "대기";
}

// "HH:MM" 형식 검사(00:00~23:59). 폼·서버 입력검증 공용.
export function isValidHm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
