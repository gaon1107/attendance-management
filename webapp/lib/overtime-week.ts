// 주간 연장근로(초과근무 관리화면) — 근로기준법 기준 순수 계산.
//  · 기본근무 = 주간 실근무 중 40시간까지 / 연장근로 = 40시간 초과분 / 한도 = 주 12시간.
//  · ⚠️ [리포트] 화면의 "초과근무"는 하루 8시간 초과분의 합(다른 기준)이다. 두 숫자가 다를 수 있어
//    화면에 기준을 명시한다. 기존 리포트 계산은 건드리지 않는다.
//  · DB·화면과 무관한 순수함수 — 임시 라우트로 검증한다.
import { WEEKLY_REGULAR_MIN, WEEKLY_EXTRA_LIMIT_MIN } from "@/lib/overtime";

export type WeeklyWork = {
  base: number; // 기본근무(분) — 최대 40시간
  extra: number; // 연장근로(분) — 40시간 초과분
  ratio: number; // 연장근로 / 주 12시간 한도 (1 이상이면 한도 초과)
};

/** 주간 실근무(분) → 기본/연장 분해. 음수 입력은 0으로 본다(방어). */
export function splitWeeklyWork(weekMinutes: number): WeeklyWork {
  const total = Math.max(0, weekMinutes);
  const base = Math.min(total, WEEKLY_REGULAR_MIN);
  const extra = Math.max(0, total - WEEKLY_REGULAR_MIN);
  return { base, extra, ratio: extra / WEEKLY_EXTRA_LIMIT_MIN };
}

export type ExtraLevel = "none" | "ok" | "near" | "over";

/**
 * 연장근로(분) → 상태.
 *  · over : 주 12시간 한도 이상(법 위반 위험) — 빨강
 *  · near : 한도의 80% 이상 — 노랑(미리 관리)
 *  · ok   : 연장은 있으나 여유 있음
 *  · none : 연장 없음
 */
export function extraLevel(extraMinutes: number): ExtraLevel {
  if (extraMinutes <= 0) return "none";
  if (extraMinutes >= WEEKLY_EXTRA_LIMIT_MIN) return "over";
  if (extraMinutes >= WEEKLY_EXTRA_LIMIT_MIN * 0.8) return "near";
  return "ok";
}

export const EXTRA_LEVEL_LABEL: Record<ExtraLevel, string> = {
  none: "연장 없음",
  ok: "정상",
  near: "한도 근접",
  over: "한도 초과",
};

/** 주(월요일 0시)의 마지막 경계 = 다음 주 월요일 0시. */
export function weekEndFrom(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7);
  return d;
}

/** "2026년 7월 3주" 같은 주 라벨(그 주 월요일 기준, 그 달의 몇 번째 월요일인지). */
export function weekLabel(weekStart: Date): string {
  const y = weekStart.getFullYear();
  const m = weekStart.getMonth() + 1;
  const nth = Math.floor((weekStart.getDate() - 1) / 7) + 1;
  return `${y}년 ${m}월 ${nth}주`;
}

/** "7/13(월) ~ 7/19(일)" 같은 기간 표기. */
export function weekRangeLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${f(weekStart)}(월) ~ ${f(end)}(일)`;
}
