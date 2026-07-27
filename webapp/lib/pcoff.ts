// PC-OFF 순수 규칙(설정 한계·알림 시점 해석). **DB·서버 전용 모듈을 import하지 않는다.**
//  · 왜 파일을 나누나: 설정 화면(브라우저에서 도는 코드)과 정책 조립(서버)이 같은 규칙을 써야 하는데,
//    서버 파일(pcoff-policy.ts)은 prisma·holiday-server를 import하므로 브라우저 번들에 들어가면 안 된다.
//    저장소 관례(shift.ts=순수 / shift-server.ts=로더)와 같은 분리다.
//  · 규칙을 바꾸려면 이 파일만 고친다(화면·서버가 어긋나지 않는 단일 출처).

// 설정 입력 한계 — 저장 액션(검증)과 설정 화면(안내문)이 같은 값을 쓴다.
export const PCOFF_LIMITS = {
  delayMin: { min: 0, max: 240 },      // 퇴근 후 유예(분). 최대 4시간.
  tempUseMin: { min: 5, max: 240 },    // 일시사용 1회 길이(분)
  tempUsePerDay: { min: 0, max: 10 },  // 하루 허용 횟수. 0 = 일시사용 안 씀.
} as const;

export const MAX_NOTIFY_MINS = 5; // 미리 알림은 최대 5개까지(알림 폭탄 방지)

// ───────────────────────── 오프라인(인터넷이 끊긴 상태) 대응 ─────────────────────────
// 사장님 결정 2026-07-27 — 전제: PC-OFF는 **회사 지급 PC 전용**.
//  (A) 근무 정보를 한 달치 미리 내려준다 → 인터넷이 끊겨도 한 달간 규칙대로 잠긴다.
//      기존(오늘·내일 이틀치)에서는 3일째부터 "오늘 정보 없음"이 되어 잠금이 사라졌다(랜선만 뽑으면 풀리는 구멍).
//  (B) 오프라인일 때 [일시사용] 한도를 넉넉하게 준다 → 외근지에서 직원이 갇히지 않게.
//      ⚠️ 무제한이 아니다. 상한이 있어야 "통제 장치"라는 성격이 남는다.

/** 서버가 내려주는 근무일 정보 일수(오늘 포함). ⚠️ 앱의 `PolicySanitizer.MaxDayDistance`와 짝이다 — 한쪽만 늘리면 앱이 잘라 버린다. */
export const POLICY_DAYS = 31;

/** 오프라인일 때의 [일시사용] 하루 한도(회). 1회 길이가 30분이면 30분 × 6 = 3시간. */
export const OFFLINE_TEMP_USE_PER_DAY = 6;

// [일시사용] 사건 종류 — 온라인/오프라인을 **다른 종류로 나눠** 기록한다.
//  · 왜 나누나: 서버가 "오늘 쓴 횟수"를 셀 때 온라인분(temp_use)만 센다.
//    그래서 금요일 밤 오프라인 사용분이 월요일에 뒤늦게 올라와도 **월요일 몫을 잡아먹지 않는다**
//    (별도 로직 없이 종류를 나누는 것만으로 해결된다).
//  · 관리자도 [PC관리]에서 평소 사용과 오프라인 사용을 구분해 볼 수 있다.
export const TEMP_USE_TYPE = "temp_use";
export const TEMP_USE_OFFLINE_TYPE = "temp_use_offline";

/** 일시사용 계열인가(사유 저장·KPI 합산·"(사유 미확인)" 표시가 이 판정을 공유한다). */
export function isTempUseType(type: string): boolean {
  return type === TEMP_USE_TYPE || type === TEMP_USE_OFFLINE_TYPE;
}

// 알림 시점 CSV("10,5") → [10,5]. 잘못된 값은 조용히 버리고, 큰 수부터 정렬한다.
//  · 0 이하·240분(4시간) 초과·숫자 아님은 제외. 중복 제거.
export function parseNotifyMins(csv: string | null | undefined): number[] {
  const list = String(csv ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 240);
  return Array.from(new Set(list)).sort((a, b) => b - a).slice(0, MAX_NOTIFY_MINS);
}

export function formatNotifyMins(mins: number[]): string {
  return mins.join(",");
}

// ───────────────────────── [일시사용] 사유 목록 ─────────────────────────
// 자유서술을 받지 않고 회사가 정한 목록에서만 고르게 한다(노무사 자료 제4권 2.1).
//  · 자유서술은 직원이 질병·가족 사정·조합 활동 같은 민감정보를 스스로 적게 되는 통로다.
//  · 구조는 lib/outing-reasons.ts와 동일(같은 문제를 이미 그렇게 풀었다).
export const DEFAULT_TEMP_REASONS = ["긴급 장애 대응", "고객 요청 마감", "결재자 부재", "기타"];
export const MAX_TEMP_REASONS = 10;   // 잠금화면 드롭다운이 길어지면 고르기 불편
export const MAX_TEMP_REASON_LEN = 20; // 한 사유의 최대 글자 수

/** 회사 설정 문자열 → 실제 사용할 사유 목록. 항상 1개 이상을 돌려준다(빈 설정이어도 동작). */
export function parseTempReasons(raw: string | null | undefined): string[] {
  const list = normalizeTempReasons(raw);
  return list.length > 0 ? list : DEFAULT_TEMP_REASONS;
}

/** 입력값 정리(폴백 없음) — 공백·빈 항목·길이초과·중복 제거 후 개수 상한. 빈 배열이면 저장할 게 없다는 뜻. */
export function normalizeTempReasons(raw: string | null | undefined): string[] {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_TEMP_REASON_LEN);
  return [...new Set(items)].slice(0, MAX_TEMP_REASONS);
}

export function formatTempReasons(list: string[]): string {
  return list.join(", ");
}

// ───────────────────────── 사건 기록 보관기간 ─────────────────────────
// 노무사 자료 제4권 3.2 — 항목별 차등 보관. "길게 보관하면 안전하다"는 착각을 막는다
// (불필요한 장기 보관 자체가 개인정보보호법 제21조 위반).
export const RETENTION_WORK_DAYS = 365 * 3; // 잠금·해제·일시사용 = 근로시간/임금 산정 근거 → 3년(근로기준법 제42조)
export const RETENTION_SYSTEM_DAYS = 90;    // 사전알림·오프라인·연결 = 근로시간과 무관한 시스템 기록 → 최소보관

// 화면에 그대로 쓰는 표기. 위 일수에서 계산하지 않고 글자로 고정한다
//  · 일수를 365로 나눠 반올림하면 값이 바뀌었을 때(예: 400일) 화면엔 "1년"으로 나와 실제와 어긋난다.
export const RETENTION_WORK_LABEL = "3년";
export const RETENTION_SYSTEM_LABEL = "90일";

/** 90일 보관 대상(장비 상태 기록). ⚠️ 파기 로직은 "이 목록에 없는 모든 종류"를 3년 보관으로 본다
 *  (새 종류를 여기 넣는 걸 잊어도 근로기록이 일찍 지워지지 않는 쪽으로 떨어지게 하기 위함). */
export const SYSTEM_EVENT_TYPES = ["notify", "offline", "paired"] as const;
