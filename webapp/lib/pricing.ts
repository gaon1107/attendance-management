// [구독 요금] 구간제 — 사장님 확정 2026-11-20. 근거·결정 과정은 루트 `plan-구독결제-요금제.md`.
//
// ⚠️ **이 파일이 요금의 단 하나의 출처다.** 홈화면·관리자 화면·앞으로 붙는 청구가 모두 여기를 읽는다.
//    화면에 숫자를 직접 적으면 두 값이 조용히 어긋나고, 어긋난 순간 "광고한 값과 청구한 값이 다른"
//    분쟁이 된다. (lib/trial.ts가 TRIAL_DAYS로 같은 원칙을 쓴다 — 같은 이유다)
//
// ⚠️ **모든 금액은 부가세 별도다.** 화면에 금액을 보일 때는 반드시 "부가세 별도"를 함께 보인다.
//    빼면 5,500원을 5,000원이라 광고한 셈이 된다(표시광고).
//
// ⚠️ 가격은 고객과의 약속이다. 숫자·구간을 바꿀 때는 **반드시 사장님 확인**을 받는다.
//
// 세는 대상 (2026-08-09 확정, 11-20 유지): **재직 중인 직원만.**
//   · 빼는 것: 회사 대표계정(isOwner — 스키마 주석이 "사람이 아니다") · 관리자(role="admin")
//              · 퇴사 처리된 계정(deactivatedAt)
//
// 왜 명당 과금을 버렸나 (사장님 지적 2026-11-20):
//   알바·계약직이 며칠만 일해도 1명분이 과금되면 고객은 그들을 **등록하지 않고** 수첩으로 관리한다.
//   그러면 제품이 "반만 쓰는 도구"가 되고 근로시간 기록에 구멍이 난다. 구간제는 구간 안에서 인원이
//   늘어도 요금이 같아 전원 등록을 유도한다. 우리 원가도 직원 수가 아니라 **회사 수**에 붙는다.
//
// ── 공개 표를 150명에서 끊은 이유 ─────────────────────────────────────────────────────
// ① **KIS 1회 결제 한도 11만원**(계약서로 12만원 요청, LMS 운영 설정 KISPG_MAX_AMOUNT=120000).
//    🔴 **한도는 부가세 포함 "총액" 기준이다.** 공급가가 아니다.
//       증거: LMS 자동결제 계획서가 "학습관제형 1년 = 112,200원 → 한도 초과로 거절"이라고 적었다
//       (공급가 102,000 + 부가세 10,200 = 112,200). 공급가 기준이면 10만원이라 걸리지 않는다.
//    → 그래서 공급가 상한은 약 109,090원(= 120,000 ÷ 1.1)이고, 한도가 11만원으로 확정되면 10만원이다.
//      101~150명 90,000원 → 총액 99,000원 → **두 한도 모두 통과**가 지금 공개 가능한 마지막 구간이다.
//    ⚠️ 2026-11-20 처음 쓸 때 이 계산을 **공급가로 잘못 해서** 151~200명(110,000원 → 총액 121,000원)을
//       표에 넣었다(code-reviewer 검수 치명 1). 받을 수 없는 금액을 광고하면, 그 회사는 체험이 끝난 뒤
//       결제할 방법이 없는데 미납 차단에 걸려 전 직원이 출퇴근을 못 찍는다. **구간을 더할 때는 반드시
//       총액(= withVat(monthly).total)으로 한도를 검산할 것.**
// ② 얼굴인증 서버가 윈도우 1대이고 **아침 9시 동시 처리량을 측정한 적이 없다.** 공개 가격을 적는 것은
//    "그 값에 그 규모를 받겠다"는 약속이다. 9시에 터지면 그 회사 전 직원이 출근을 못 찍는다.

/** 요금 구간 하나. `max` = 이 구간의 최대 재직 직원 수, `monthly` = 월 요금(부가세 별도, 원). */
export type PriceTier = { max: number; monthly: number };

/**
 * 구간표. **`max` 오름차순이어야 한다** — `tierFor`가 위에서부터 찾아 첫 번째로 맞는 구간을 쓴다.
 * (어긋나면 조용히 틀린 금액이 나오므로 아래에 개발 모드 검사를 뒀다.)
 *
 * ⚠️ 구간 **상한**의 명당 단가는 1,000원 이하다(5명→1,000 / 20명→900 / 100명→650).
 *    그러나 구간 **하한**에서는 1,000원을 넘는다(6명 → 10,000÷6 = 1,667원/명).
 *    → **"직원 1명당 1,000원보다 싸다"고 광고하면 6·11·16·21·31명 회사에게 허위광고가 된다.**
 *      쓸 수 있는 말은 "10명까지 10,000원"처럼 **구간 금액 그대로**다. (검수 중간 8)
 *
 * ⚠️ 구간을 더하거나 금액을 바꿀 때 한도·오름차순·자릿수는 **아래 `validateTiers`가 자동으로 막는다.**
 *    사람이 기억으로 검산하지 않는다 — 그 기억이 2026-11-20에 실패했다.
 */
export const PRICE_TIERS: readonly PriceTier[] = [
  { max: 5, monthly: 5_000 },
  { max: 10, monthly: 10_000 },
  { max: 15, monthly: 14_000 },
  { max: 20, monthly: 18_000 },
  { max: 25, monthly: 22_000 },
  { max: 30, monthly: 25_000 },
  { max: 40, monthly: 32_000 },
  { max: 50, monthly: 38_000 },
  { max: 70, monthly: 49_000 },
  { max: 100, monthly: 65_000 },
  { max: 150, monthly: 90_000 },
  // 151~200명(110,000원)은 **뺐다** — 총액 121,000원이 KIS 1회 한도를 넘는다(머리말 ① 참조).
  // 되살리려면 KIS 1회 한도 상향(총액 기준 최소 13만원)을 먼저 받아야 한다.
];

/** 공개 요금표의 마지막 인원. 이 수를 넘으면 공개 가격이 없다(별도 협의). */
export const QUOTE_OVER: number = PRICE_TIERS[PRICE_TIERS.length - 1].max;

/** 부가세율 10%. */
const VAT_RATE = 0.1;

/**
 * KIS 1회 결제 한도 — **부가세 포함 총액** 기준(계약 11만원. 계약서로 12만원을 요청해 둔 상태이고
 * LMS 운영 설정은 `KISPG_MAX_AMOUNT=120000`). 좁은 쪽인 11만원을 기준으로 둔다.
 *
 * 한도가 실제로 올라가면 **이 한 줄만** 고치면 요금표 검사가 따라 움직인다.
 *
 * ⚠️ 총액이 **정확히** 한도와 같을 때 KIS가 통과시키는지("이하"인지 "미만"인지)는 확인된 적이 없다.
 *    구간을 더할 때는 5% 정도 여유를 두는 것이 안전하다(총액 105,000원 이하).
 */
export const KIS_MAX_TOTAL = 110_000;

/**
 * 구간표가 성립하는지 검사해 **문제 목록**을 돌려준다(문제가 없으면 빈 배열).
 *
 * 왜 함수로 뺐나: 주석에 "한도를 검산할 것"이라고 적어 두는 것은 **사람의 기억에 맡기는 것**이고,
 * 바로 그 기억이 2026-11-20에 실패해서 "카드로 받을 수 없는 금액"(총액 121,000원)을 광고하는 표가
 * 만들어졌다. 기억이 아니라 코드가 막아야 한다. (검수 중간 2)
 *
 * 검사하는 것:
 *  · 구간표가 비어 있지 않은지 — 비면 `QUOTE_OVER`가 터져 홈화면이 안 뜬다.
 *  · `max`·`monthly`가 양의 정수인지 — `{max: 7.5}`면 "6~7.5명" 같은 라벨이 만들어진다.
 *  · `max` 오름차순 — 어긋나면 `tierFor`가 **오류 없이** 틀린 금액을 돌려준다(가장 위험한 조용한 오류).
 *  · `monthly` 오름차순 — `65_000`을 `6_500`으로 치는 **자릿수 오타**가 여기서 걸린다.
 *    (tsc·eslint·`max` 검사를 전부 통과해 "71~100명 6,500원"이 그대로 공개될 수 있었다)
 *  · 카드 승인액(= 총액)이 KIS 1회 한도 안인지 — **광고는 되는데 결제가 거절되는** 구간을 막는다.
 */
export function validateTiers(tiers: readonly PriceTier[]): string[] {
  const problems: string[] = [];
  if (tiers.length === 0) {
    problems.push("구간표가 비어 있다. QUOTE_OVER가 터지고 홈화면이 뜨지 않는다.");
    return problems;
  }
  tiers.forEach((t, i) => {
    const prev = i === 0 ? null : tiers[i - 1];
    if (!Number.isInteger(t.max) || t.max <= 0) {
      problems.push(`${i}번 구간의 max가 양의 정수가 아니다(${t.max}).`);
    }
    if (!Number.isInteger(t.monthly) || t.monthly <= 0) {
      problems.push(`${i}번 구간의 monthly가 양의 정수가 아니다(${t.monthly}).`);
    }
    if (prev && t.max <= prev.max) {
      problems.push(`max가 오름차순이 아니다: ${i - 1}번(${prev.max}명) → ${i}번(${t.max}명). tierFor가 조용히 틀린 금액을 돌려준다.`);
    }
    if (prev && t.monthly <= prev.monthly) {
      problems.push(`monthly가 오름차순이 아니다: ${i - 1}번(${prev.monthly}원) → ${i}번(${t.monthly}원). 자릿수 오타가 아닌지 확인할 것.`);
    }
    const total = withVat(t.monthly).total;
    if (total > KIS_MAX_TOTAL) {
      problems.push(`${i}번 구간(${t.max}명 ${t.monthly}원)의 카드 승인액이 ${total}원인데 KIS 1회 한도는 ${KIS_MAX_TOTAL}원이다. 광고는 되고 결제는 거절된다 — 한도 상향을 먼저 받을 것.`);
    }
  });
  return problems;
}

// [개발 모드 검사] 모듈을 읽을 때 한 번 돈다.
//  · 운영에서는 돌지 않는다 — 공개 홈화면이 이 검사 때문에 500이 되면 더 큰 사고다. 개발·검증 중에
//    홈화면을 한 번 열면 반드시 걸리므로(완료 선언 전 3000 렌더 확인이 이 프로젝트의 절차다)
//    운영까지 갈 수 없다.
if (process.env.NODE_ENV !== "production") {
  const problems = validateTiers(PRICE_TIERS);
  if (problems.length > 0) {
    throw new Error(`[pricing] 구간표에 문제가 있다:\n- ${problems.join("\n- ")}`);
  }
}

/**
 * 재직 직원 수에 해당하는 구간을 찾는다.
 *  · 공개 표를 넘으면 **null** — 화면은 "별도 협의"로 보여야 한다. 넘는 금액을 짐작해 채우지 않는다.
 *  · 숫자가 아닌 값(NaN·Infinity)도 **null**이다. 인원을 `Number(...)`로 파싱하는 호출처가 생겼을 때
 *    5명 회사가 첫 구간으로 둔갑하는 것보다, 금액을 안 보여 주는 쪽이 안전하다. (검수 중간 7b)
 *
 * 🔴 **0명·음수를 청구에 쓰지 말 것.** 이 함수는 0명도 첫 구간을 돌려준다 — 요금표를 **보여 주기** 위한
 *    값이다. `tierFor(count).monthly`를 그대로 청구에 넣으면 **재직 직원이 0명인 회사에 5,000원이
 *    청구된다.** 직원 0명 회사에 청구할지는 아직 정해지지 않았다(plan-구독결제-요금제.md 2장).
 *    결제를 붙이는 단계에서 호출처가 `employees <= 0`을 **명시적으로** 처리해야 한다. (검수 중간 7c)
 */
export function tierFor(employees: number): PriceTier | null {
  if (!Number.isFinite(employees)) return null;
  for (const t of PRICE_TIERS) if (employees <= t.max) return t;
  return null;
}

/**
 * 재직 직원 수가 몇 번째 구간인지(PRICE_TIERS의 자리). 공개 표를 넘거나 숫자가 아니면 **null**.
 *
 * `PRICE_TIERS.findIndex(...)`를 직접 쓰지 말고 이 함수를 쓴다 — findIndex는 못 찾으면 **-1**을
 * 돌려주고, 그 -1을 `tierLabel`에 넘기면 라벨이 빈칸이 된다. 201명 회사에서 정확히 그 -1이 나온다.
 * (검수 중간 6)
 */
export function tierIndexFor(employees: number): number | null {
  if (!Number.isFinite(employees)) return null;
  const i = PRICE_TIERS.findIndex((t) => employees <= t.max);
  return i === -1 ? null : i;
}

/**
 * 공급가(부가세 별도) → 공급가·부가세·합계.
 * 부가세는 **원 단위 내림**이다 — 카드 승인 금액은 정수여야 하고, 올림하면 고객이 1원을 더 낸다.
 * (구간 금액이 모두 1,000원 배수라 지금은 나누어떨어진다. 내림은 나중에 금액을 바꿀 때를 위한 방어다.)
 *
 * **카드 결제 금액은 여기서 나오는 `total`이다.** KIS 1회 한도도 이 `total`과 견준다(머리말 ① 참조).
 */
export function withVat(supply: number): { supply: number; vat: number; total: number } {
  const vat = Math.floor(supply * VAT_RATE);
  return { supply, vat, total: supply + vat };
}

/** "5,000원" — 화면 표시용. */
export function formatWon(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/**
 * 구간 이름 "1~5명" · "6~10명". `index`는 PRICE_TIERS의 자리.
 * 범위를 벗어나면 **null**이다(예외를 던지지 않는다 — 공개 홈화면이 500이 되는 것이 더 큰 사고다).
 * 구간 번호는 `tierIndexFor`로 얻을 것. (검수 중간 6)
 */
export function tierLabel(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= PRICE_TIERS.length) return null;
  const from = index === 0 ? 1 : PRICE_TIERS[index - 1].max + 1;
  return `${from}~${PRICE_TIERS[index].max}명`;
}
