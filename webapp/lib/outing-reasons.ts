// 외출 사유(실시간 외출 기록 = Break.reason)의 회사별 목록 — 규칙 단일 출처.
//  · 저장 형식: Company.outingReasons = 쉼표로 구분한 한 줄(officeIps·workDays와 같은 관례).
//  · 비어 있거나 전부 걸러지면 기본 4종으로 폴백 → 설정 안 한 회사는 기존과 동일하게 동작(회귀 0).
//  · 화면(드롭다운)·서버액션(저장·검증)이 모두 이 함수를 쓴다. 규칙이 두 군데로 갈라지지 않게.
//  ※ 외출/외근 "결재 신청"(OutingRequest)의 자유입력 사유와는 무관하다.

export const DEFAULT_OUTING_REASONS = ["식사", "외근", "개인용무", "기타"];
export const MAX_OUTING_REASONS = 10; // 드롭다운이 길어지면 고르기 불편
export const MAX_REASON_LEN = 20; // 한 사유의 최대 글자 수

/** 회사 설정 문자열 → 실제 사용할 사유 목록. 항상 1개 이상을 돌려준다. */
export function parseOutingReasons(raw: string | null | undefined): string[] {
  const list = normalizeOutingReasons(raw);
  return list.length > 0 ? list : DEFAULT_OUTING_REASONS;
}

/**
 * 입력값 정리(폴백 없음) — 공백 제거·빈 항목 제거·길이 초과 제거·중복 제거·개수 상한.
 * 저장 전 검증에서 "무엇이 남는지"를 보려면 이걸 쓴다(빈 배열이면 저장할 게 없다는 뜻).
 */
export function normalizeOutingReasons(raw: string | null | undefined): string[] {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_REASON_LEN);
  return [...new Set(items)].slice(0, MAX_OUTING_REASONS);
}

/** 목록 → 저장·표시용 한 줄 문자열. */
export function formatOutingReasons(list: string[]): string {
  return list.join(", ");
}
