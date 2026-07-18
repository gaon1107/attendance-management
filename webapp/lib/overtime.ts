// 주 52시간 초과근무 알림(B-3) — 이번 주 실근무 합계를 법정 상한과 비교한다.
// 근로기준법상 1주 = 7일. 우리는 "월요일 00:00 ~ 현재"를 1주로 본다(서버 TZ=Asia/Seoul 가정 — 전사 공통 규칙).
// 소정근로 40h + 연장 12h = 52h가 법정 상한. 이 값은 법으로 고정(회사가 낮추면 더 엄격할 뿐 무해하므로 조정 대상 아님).
// ※ 여기는 순수 계산만 — DB·화면과 무관하게 단위 테스트로 검증한다.

// 주 52시간 법정 상한(분). 이 값 이상이면 "초과"(법 위반 위험).
export const LEGAL_WEEKLY_LIMIT_MIN = 52 * 60; // 3120분

// 이번 주의 시작 = 월요일 00:00 (로컬 시간대 기준).
// 일요일(getDay 0)은 그 주의 마지막 날이므로 6일 전 월요일로 되돌린다.
export function weekStartMonday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=일 … 6=토
  const backToMonday = (dow + 6) % 7; // 월=0, 화=1 … 일=6
  d.setDate(d.getDate() - backToMonday);
  return d;
}

// 주간 합산에서 기록 1건의 "종료 시각"을 정한다.
//  · 퇴근했으면 그 시각 그대로.
//  · 미퇴근이면 현재(now)까지 — 단 출근한 날의 자정을 넘지 못하게 막는다.
// 이유: 직원이 퇴근 버튼을 잊으면 그 기록이 며칠씩 열려 있게 되는데(자동 마감 없음),
//   주간 합산에서 이를 now까지 세면 한 건이 수십 시간으로 부풀어 허위 "초과(빨강)" 경보가 난다.
//   자정을 넘기지 않는 사무직 주간근무를 가정하는 기존 지각·조퇴 판정과 같은 전제.
// ※ 오늘 진행 중인 정상 기록은 now가 아직 그 날 자정 이전이라 영향받지 않는다(실시간 정확).
export function cappedEnd(clockIn: Date, clockOut: Date | null, now: Date): Date {
  if (clockOut) return clockOut;
  const nextMidnight = new Date(clockIn);
  nextMidnight.setHours(24, 0, 0, 0); // 출근일 바로 다음 자정
  return now < nextMidnight ? now : nextMidnight;
}

export type OvertimeLevel = "ok" | "warn" | "over";

// 주간 실근무(분)과 회사 경고선(시간)으로 단계 판정.
//  · over : 법정 52h 이상 → 빨강(법 위반 위험)
//  · warn : 경고선 이상이면서 52h 미만 → 노랑(근접, 미리 관리)
//  · ok   : 그 외
// 경고선이 52h 이상으로 설정돼도 안전하다(over를 먼저 판정 → warn 구간이 비어 있을 뿐).
export function weeklyLevel(weekMinutes: number, warnHours: number): OvertimeLevel {
  if (weekMinutes >= LEGAL_WEEKLY_LIMIT_MIN) return "over";
  if (weekMinutes >= Math.round(warnHours * 60)) return "warn";
  return "ok";
}
