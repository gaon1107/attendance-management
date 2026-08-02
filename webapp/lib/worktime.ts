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

// ── [검수 C-6] 미퇴근 기록의 "계산상 종료 시각" ────────────────────────────
// 퇴근 버튼을 잊으면 그 기록이 며칠씩 열려 있는데(자동 마감 없음), 이를 "지금"까지로 세면
// 한 건이 수백 시간으로 부풀어 리포트·법정 증빙 엑셀에 그대로 인쇄된다.
// 예전엔 이 상한이 대시보드·초과근무·휴게시간 3곳에만 있고 리포트·엑셀·근로기록부·근태현황·
// 내근태 5곳에는 없어서, **같은 주인데 화면마다 근무시간이 달랐다.**
//
// 규칙:
//   ① 퇴근을 찍었으면 그 시각 그대로.
//   ② 아직 24시간이 안 지난 열린 기록 = **진행 중인 근무** → 지금까지 사실대로 센다.
//      (밤 10시 출근→새벽 2시 같은 야간 교대도 여기 해당해 정확히 잡힌다.
//       예전 방식은 출근일 자정에서 잘라 야간근무를 실제보다 적게 셌다.)
//   ③ 24시간이 넘도록 안 닫힌 기록 = **퇴근을 잊은 것** → 출근일 자정까지만 센다.
//      (사무직 주간근무를 전제한 기존 지각·조퇴 판정과 같은 가정)
export function effectiveEnd(clockIn: Date, clockOut: Date | null, now: Date = new Date()): Date {
  if (clockOut) return clockOut;
  const sessionEnd = new Date(clockIn.getTime() + OPEN_SESSION_MS);
  if (now <= sessionEnd) return now; // 진행 중인 근무 — 사실대로
  const nextMidnight = new Date(clockIn);
  nextMidnight.setHours(24, 0, 0, 0); // 출근일 바로 다음 자정
  return nextMidnight;
}

// 퇴근을 안 찍어 "계산상 잘라낸" 기록인지 — 화면에 (미퇴근)으로 표시할 때 쓴다.
export function isUnclosed(clockOut: Date | null, clockIn: Date, now: Date = new Date()): boolean {
  return !clockOut && now > new Date(clockIn.getTime() + OPEN_SESSION_MS);
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
