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

/**
 * 오프라인 [일시사용] 횟수를 **늘려 줄 때** 참고하는 총 시간(분).
 *  · 왜 시간을 보나: 1회 길이를 회사가 240분까지 정할 수 있어(PCOFF_LIMITS), 횟수만 보고 늘리면
 *    240분 × 6회 = 24시간이 되어 랜선만 뽑으면 PC-OFF가 사실상 없는 것이 된다.
 *  · ⚠️ **이것은 절대 상한이 아니다.** 아래 계산이 회사가 정한 하루 횟수보다 적게 주지 않기 때문이다
 *    (오프라인이 온라인보다 빡빡하면 갇히는 것을 못 막는다). 예: 120분 × 3회 회사 → 오프라인도 3회 = 360분.
 *    "총 시간을 진짜로 묶을 것인가"는 사장님 결정 사항으로 남겨 두었다(검수 지적 N-5).
 */
export const OFFLINE_TEMP_USE_MAX_MIN = 180;

/**
 * 앱이 보낸 시각이 지금보다 **앞서** 있어도 받아 주는 한계(분).
 *  · 왜 넉넉해야 하나: 한 달간 인터넷이 끊긴 PC는 그동안 서버와 시계를 맞추지 못한다.
 *    PC 시계가 한 달에 몇 분 빨라지는 것은 흔한데, 그 오차 때문에 **한 달치 잠금 기록이 통째로 버려지면**
 *    되돌릴 수 없다(서버가 200을 주므로 앱은 지운다 — 검수 지적 N-4).
 *  · 그렇다고 무제한으로 두면 "미래 시각으로 보내 오늘 집계를 피하는" 길이 열리므로 1시간으로 막는다.
 */
export const EVENT_FUTURE_TOLERANCE_MIN = 60;

/**
 * 이 회사의 오프라인 [일시사용] 하루 한도(회)를 계산한다. **서버·앱이 이 값 하나만 쓴다**
 * (서버가 정책에 실어 내려주므로 앱에 같은 숫자를 또 적어 두지 않는다 = 짝이 어긋날 수 없다).
 *  · 회사가 일시사용을 안 쓰면(0회) 오프라인에서도 0 — 회사 정책을 앱이 뒤집지 않는다.
 *  · 평소 한도보다 줄지 않는다(온라인보다 오프라인이 빡빡하면 갇히는 것을 못 막는다).
 */
export function offlineTempUsePerDay(tempUseMinutes: number, perDay: number): number {
  if (!(perDay > 0) || !(tempUseMinutes > 0)) return 0;
  const byTime = Math.max(1, Math.floor(OFFLINE_TEMP_USE_MAX_MIN / tempUseMinutes));
  return Math.max(perDay, Math.min(OFFLINE_TEMP_USE_PER_DAY, byTime));
}

/**
 * 앱이 보낸 사건을 받아 줄 수 있는 **과거 한계**(일).
 *  · 🔴 정책 일수(POLICY_DAYS)보다 넉넉해야 한다. 30일로 두면 한 달간 오프라인이던 PC가 돌아왔을 때
 *    **첫날의 잠금·해제 기록이 버려지고**, 서버가 200을 주므로 앱은 지워 버려 되살릴 수 없다(검수 지적 M-2).
 *    잠금·해제는 근로시간 근거(3년 보존 대상)라 잃으면 안 된다.
 */
export const EVENT_MAX_AGE_DAYS = POLICY_DAYS + 14;

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
