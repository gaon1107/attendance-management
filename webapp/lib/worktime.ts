// 실근무시간 계산 — 실근무 = (종료 - 출근) - 외출시간 합.
// 아직 진행 중인 항목(퇴근 전/복귀 전)은 "지금(now)"까지로 계산한다.

type BreakLike = { startAt: Date; endAt: Date | null };
type AttendanceLike = { clockIn: Date; clockOut: Date | null; breaks: BreakLike[] };

// 실근무 시간을 분(minute) 단위로 반환
// ── [검수 C-4] "지금 근무 중"으로 볼 열린 출근 기록의 시간 범위 ──────────────
// 퇴근을 안 찍은 기록이 하나라도 있으면 그 뒤 출근이 전부 막히던 문제를 고치면서 도입.
//   · 24시간 안에 시작된 열린 기록 = 지금 근무 중(야간 교대 포함)
//   · 그보다 오래된 열린 기록 = 퇴근을 못 찍고 넘어간 것 → "근무 중"으로 보지 않는다.
//     (그 기록을 임의로 닫지는 않는다. 실제 퇴근 시각은 사람만 알기 때문 — 관리자가 [근태 정정]으로 바로잡는다)
// ⚠️ 서버 액션(app/actions/attendance.ts)과 화면이 **같은 기준**을 써야 한다. 바꿀 땐 양쪽을 함께 본다.
export const OPEN_SESSION_MS = 24 * 60 * 60 * 1000;

export function openSessionSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - OPEN_SESSION_MS);
}

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

// 조퇴 여부 판정 — 회사가 정한 퇴근 기준시각보다 일찍 퇴근하면 조퇴. (지각 isLate와 대칭, 유예 없음)
// 퇴근 기록이 없거나(근무중) 기준시각이 없으면(회사 미설정) null을 반환한다(조퇴 판정 안 함).
// ※ isLate와 동일하게 시:분(time-of-day)만 비교한다 — 자정을 넘겨 근무하는 야간근무는 정확히 판정하지 못하는
//    기존 지각 판정과 같은 한계를 공유한다(사무직 주간근무 대상).
export function isEarlyLeave(clockOut: Date | null, workEndTime: string | null): boolean | null {
  if (!clockOut || !workEndTime) return null;
  const [h, m] = workEndTime.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const limit = h * 60 + m; // 퇴근 기준시각을 분으로
  const outMinutes = clockOut.getHours() * 60 + clockOut.getMinutes();
  return outMinutes < limit;
}
