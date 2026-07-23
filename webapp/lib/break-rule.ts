// 휴게시간 준수 점검(근로기준법 제54조) — 판정·표시 전용 순수함수.
//  · 법: 근로시간 4시간 초과 시 30분 이상, 8시간 초과 시 1시간 이상의 휴게를 근로시간 도중에 부여.
//  · ⚠️ 이 파일은 실근무시간을 바꾸지 않는다. 계산은 lib/worktime.ts(퇴근−출근−외출)가 그대로 담당하고,
//    여기서는 "그날 쉰 시간(외출 기록 합계)이 최소 기준에 못 미치는가"만 판정한다.
//  · 회사가 법정보다 더 넉넉히 주도록 기준을 올릴 수 있다(설정값). 기본값 = 법정 최소.

export const LEGAL_BREAK_MIN_4H = 30; // 4시간 초과 근무 시 법정 최소 휴게(분)
export const LEGAL_BREAK_MIN_8H = 60; // 8시간 초과 근무 시 법정 최소 휴게(분)
export const MAX_BREAK_RULE_MIN = 480; // 설정 상한(8시간) — 오입력 방어

export type BreakRule = { min4h: number; min8h: number };

export const DEFAULT_BREAK_RULE: BreakRule = { min4h: LEGAL_BREAK_MIN_4H, min8h: LEGAL_BREAK_MIN_8H };

/** 그날 근무시간(분)에 대해 최소 몇 분을 쉬어야 하는가. 4시간 이하 근무면 의무 없음(0). */
export function requiredBreakMinutes(workedMin: number, rule: BreakRule = DEFAULT_BREAK_RULE): number {
  if (workedMin > 8 * 60) return Math.max(0, rule.min8h);
  if (workedMin > 4 * 60) return Math.max(0, rule.min4h);
  return 0;
}

export type BreakStatus = "none" | "ok" | "short";

export type BreakJudgement = {
  required: number; // 필요한 최소 휴게(분)
  actual: number; // 실제 휴게(분) = 그날 외출 기록 합계
  shortage: number; // 부족분(분). 0이면 충족
  status: BreakStatus; // none=의무 없음 / ok=충족 / short=부족
};

/**
 * 하루치 판정.
 *  · 근무 중(퇴근 전)인 기록도 그 시점까지로 판정할 수 있으나, 아직 쉴 시간이 남아 있으므로
 *    화면에서는 "퇴근한 기록"만 부족으로 강조하는 것을 권장한다(판정 자체는 순수하게 유지).
 */
export function judgeBreak(workedMin: number, breakMin: number, rule: BreakRule = DEFAULT_BREAK_RULE): BreakJudgement {
  const required = requiredBreakMinutes(workedMin, rule);
  const actual = Math.max(0, breakMin);
  const shortage = Math.max(0, required - actual);
  return {
    required,
    actual,
    shortage,
    status: required === 0 ? "none" : shortage > 0 ? "short" : "ok",
  };
}

/** 설정 입력값 정리 — 숫자가 아니거나 범위를 벗어나면 기본값으로. (검증은 parseBreakRuleInput이 담당) */
export function normalizeBreakRule(min4h: unknown, min8h: unknown): BreakRule {
  const clamp = (v: unknown, fallback: number): number => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > MAX_BREAK_RULE_MIN) return fallback;
    return n;
  };
  return {
    min4h: clamp(min4h, LEGAL_BREAK_MIN_4H),
    min8h: clamp(min8h, LEGAL_BREAK_MIN_8H),
  };
}

/**
 * 저장용 입력 해석 — 범위를 벗어나면 **조용히 기본값으로 바꾸지 않고 에러**를 돌려준다.
 * (숫자 입력칸의 max는 브라우저에서 우회할 수 있으므로 서버가 다시 본다.)
 */
export function parseBreakRuleInput(min4h: unknown, min8h: unknown): { rule?: BreakRule; error?: string } {
  const one = (v: unknown): number | null => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > MAX_BREAK_RULE_MIN) return null;
    return n;
  };
  const a = one(min4h);
  const b = one(min8h);
  if (a === null || b === null) {
    return { error: `휴게 기준은 0~${MAX_BREAK_RULE_MIN}분 사이의 숫자로 입력해주세요.` };
  }
  return { rule: { min4h: a, min8h: b } };
}

export const BREAK_STATUS_LABEL: Record<BreakStatus, string> = {
  none: "의무 없음",
  ok: "준수",
  short: "휴게 부족",
};
