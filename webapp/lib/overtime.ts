// 주 52시간 초과근무 알림(B-3) — 이번 주 실근무 합계를 법정 상한과 비교한다.
// 근로기준법상 1주 = 7일. 우리는 "월요일 00:00 ~ 현재"를 1주로 본다(서버 TZ=Asia/Seoul 가정 — 전사 공통 규칙).
// 소정근로 40h + 연장 12h = 52h가 법정 상한. 이 값은 법으로 고정(회사가 낮추면 더 엄격할 뿐 무해하므로 조정 대상 아님).
// ※ 여기는 순수 계산만 — DB·화면과 무관하게 단위 테스트로 검증한다.

// 주 52시간 법정 상한(분). 이 값 이상이면 "초과"(법 위반 위험).
export const LEGAL_WEEKLY_LIMIT_MIN = 52 * 60; // 3120분

// ── [add-only] 초과근무 관리화면(2026-07-23)에서 쓰는 상수. 기존 함수·판정은 무수정. ──
// 소정근로 주 40시간. 이 시간까지가 "기본근무", 넘는 분이 "연장근로".
export const WEEKLY_REGULAR_MIN = 40 * 60; // 2400분
// 연장근로 법정 한도 주 12시간(40+12=52). 이 값 이상이면 한도 초과.
export const WEEKLY_EXTRA_LIMIT_MIN = 12 * 60; // 720분

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
// 2026-08-02 검수 C-6: 이 상한이 일부 화면에만 있어 같은 데이터의 근무시간이 화면마다 달랐다.
//   계산 규칙 자체를 lib/worktime.ts의 effectiveEnd 하나로 모으고, 여기서는 그대로 위임한다.
//   (야간 교대가 실제보다 적게 계산되던 문제도 그쪽에서 함께 해결됨 — 설명은 worktime.ts 참고)
export { effectiveEnd as cappedEnd } from "@/lib/worktime";

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
