// 회사 해지(탈퇴) 뒤 30일 규칙 — 단일 출처 (2026-11-22 해지 2단계).
//
// 이용약관 제14조 ④: "이용계약이 끝나면 회사는 30일 동안 자료를 보관한 뒤 파기합니다."
//  · 해지 시각 + 30일 이 지나기 전  → 보관 중. [되살리기] 가능.
//  · 해지 시각 + 30일 이 지난 뒤    → 파기 대상. [되살리기] 불가. 그 뒤 첫 새벽에 자동 파기(lib/company-purge.ts).
//  · 파기가 시작됨(purgeStartedAt) → [되살리기] 불가(반쯤 지워진 회사가 되살아나면 안 된다).
//
// 🔴 화면(운영자 회사 상세)·서버 액션(되살리기)·파기 엔진이 **이 파일 하나**를 쓴다.
//    기준이 어긋나면 "버튼은 켜지는데 서버가 거부" 또는 "되살린 직후 파기"가 생긴다(lib/company-name.ts와 같은 이유).
// ⚠️ 이 파일은 화면(클라이언트)에서도 불린다 — DB·서버 전용 모듈을 import하지 말 것.

/** 해지 후 보관 기간(일). 약관 제14조 ④. ⚠️ 바꾸면 약관·처리방침을 먼저 고쳐야 한다. */
export const TERMINATION_RETENTION_DAYS = 30;

/**
 * 파기 대상이 되는 시각 = 해지 시각 + 30일(달력 기준).
 *  · 밀리초(30×24시간)로 더하지 않고 날짜로 더한다 — 서버 TZ=Asia/Seoul(서머타임 없음)이라 결과는 같지만,
 *    "30일"을 사람이 읽는 달력 뜻 그대로 계산해 두는 편이 나중에 읽는 사람이 헷갈리지 않는다.
 */
export function purgeDueAt(terminatedAt: Date): Date {
  const d = new Date(terminatedAt);
  d.setDate(d.getDate() + TERMINATION_RETENTION_DAYS);
  return d;
}

/** 보관 기간(30일)이 끝났는가. 해지되지 않은 회사는 언제나 false. */
export function isRetentionOver(terminatedAt: Date | null, now: Date = new Date()): boolean {
  if (!terminatedAt) return false;
  return now.getTime() >= purgeDueAt(terminatedAt).getTime();
}

/**
 * 되살리기를 막아야 하는 이유. 막을 이유가 없으면 null.
 *  · 화면은 이 값이 있으면 버튼 대신 안내를 보여 주고, 서버 액션은 이 값이 있으면 거부한다.
 */
export function restoreBlockedReason(
  c: { terminatedAt: Date | null; purgeStartedAt: Date | null },
  now: Date = new Date()
): string | null {
  if (!c.terminatedAt) return null; // 해지되지 않은 회사 — 되살릴 것도 없다(호출부가 따로 처리)
  if (c.purgeStartedAt) return "자동 파기가 이미 시작되어 되살릴 수 없습니다.";
  if (isRetentionOver(c.terminatedAt, now)) {
    return `해지 후 ${TERMINATION_RETENTION_DAYS}일 보관 기간이 끝나 되살릴 수 없습니다(곧 자동 파기됩니다).`;
  }
  return null;
}
