// 실근무시간 계산 — 실근무 = (종료 - 출근) - 외출시간 합.
// 아직 진행 중인 항목(퇴근 전/복귀 전)은 "지금(now)"까지로 계산한다.

type BreakLike = { startAt: Date; endAt: Date | null };
type AttendanceLike = { clockIn: Date; clockOut: Date | null; breaks: BreakLike[] };

// 실근무 시간을 분(minute) 단위로 반환
export function workedMinutes(att: AttendanceLike, now: Date = new Date()): number {
  const end = att.clockOut ?? now;
  const totalMs = end.getTime() - att.clockIn.getTime();

  let breakMs = 0;
  for (const b of att.breaks) {
    const bEnd = b.endAt ?? now;
    breakMs += bEnd.getTime() - b.startAt.getTime();
  }

  const workedMs = totalMs - breakMs;
  return Math.max(0, Math.round(workedMs / 60000));
}

// 분 → "8시간 48분" 형태 문자열
export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}

// 지각 여부 판정 — 회사가 정한 출근 기준시각 + 유예(분) 이후 출근이면 지각.
// 기준시각이 없으면(회사 미설정) null을 반환한다(지각 판정 안 함).
export function isLate(clockIn: Date, workStartTime: string | null, graceMin: number): boolean | null {
  if (!workStartTime) return null;
  const [h, m] = workStartTime.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const limit = h * 60 + m + graceMin; // 기준시각+유예를 분으로
  const inMinutes = clockIn.getHours() * 60 + clockIn.getMinutes();
  return inMinutes > limit;
}
