// 재택근무 신청 — 상태 라벨의 단일 출처. (휴가 lib/leave.ts의 축소판)
//  · 승인은 "허가 기록"만 남긴다 — 근태/실근무 판정 로직과 무관(사장님 결정 2026-07-20).

export function remoteStatusLabel(status: string): string {
  if (status === "approved") return "승인";
  if (status === "rejected") return "반려";
  return "대기";
}
