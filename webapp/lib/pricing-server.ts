// [과금 인원] 구독 요금을 계산할 때 "몇 명"으로 세는지 — **이 파일이 단일 출처**다.
//
// 순수 계산(구간·부가세)은 `lib/pricing.ts`에 있고, 여기는 DB를 읽는 부분만 둔다.
// (저장소 관례: `shift.ts`(순수) + `shift-server.ts`(로더)와 같은 짜임새)
//
// 🔴 **왜 기존 집계 함수를 쓰지 않는가** (2026-11-20 확인):
//   `lib/operator-companies.ts`는 회사별 인원을 `isOwner: false, deactivatedAt: null`로 센다.
//   그건 **관리자까지 포함한 "사람 수"**다(운영자 화면에 보여주는 숫자). 과금 기준은 다르다 —
//   **재직 중인 '직원'만** 세고 관리자·회사 계정·퇴사자는 빼는 것이 2026-08-09 확정 원칙이다.
//   두 숫자를 같은 것으로 착각하면 "화면에는 10명인데 11명 요금이 청구됨" 같은 분쟁이 된다.
//   그래서 과금용 조건을 여기 한 곳에 박아 두고, 화면·결제·동의 흐름이 모두 이것만 쓰게 한다.
//
// 세는 조건 (plan-구독결제-요금제.md 2장 + 9장 4번):
//   · `role: "employee"`  — 재직 직원.
//   · 🔄 2026-11-23 사장님 결정: **사람 관리자는 1명까지만 빼고, 2명째부터는 직원처럼 센다**(관리자 수 제한은 없다).
//     예전엔 관리자를 전부 뺐는데, 그러면 전원을 관리자로 지정해 요금 0원이 되는 구멍이 있었다(요금제 계획서 검수 치명 2).
//     과금 인원 = 재직 직원 + max(0, 재직 사람 관리자 − 1).
//   · `isOwner: false`    — 회사 계정(마스터 키)은 사람이 아니다. role은 admin이라 위 조건으로도
//                           걸러지지만, 역할 체계가 바뀌어도 새지 않도록 함께 못박아 둔다.
//   · `deactivatedAt: null` — 퇴사(비활성) 계정 제외. 과거 근태 기록은 남지만 요금은 세지 않는다.
//
// ⚠️ 세는 시점은 "지금"이다. 월중 입·퇴사는 일할 계산하지 않는다(2장) —
//    청구는 결제일의 인원으로 한 번 정하고, 인원이 줄면 **다음 결제분부터** 낮은 구간이 된다.
import { prisma } from "@/lib/db";
import { quoteFor, type Quote } from "@/lib/pricing";

/** 과금 대상 직원을 고르는 조건. 다른 곳에서 직접 조건을 쓰지 말고 이것을 가져다 쓴다. */
export const BILLABLE_EMPLOYEE_WHERE = {
  role: "employee",
  isOwner: false,
  deactivatedAt: null,
} as const;

/** 요금에서 빼 주는 사람 관리자 수(2026-11-23 사장님 결정). 바꾸면 화면 안내([구독·요금])도 함께 바꿀 것. */
export const FREE_ADMIN_COUNT = 1;

/** 과금 인원에 들어갈 수 있는 사람 관리자 — 회사 계정·퇴사자 제외. */
const HUMAN_ADMIN_WHERE = { role: "admin", isOwner: false, deactivatedAt: null } as const;

/**
 * 이 회사의 과금 인원 = 재직 직원 + (재직 사람 관리자 − 1명, 0 아래로는 안 내려감).
 *  · 함수 이름은 예전 그대로 둔다(호출처·문서가 이 이름으로 가리킨다). 뜻은 "요금을 매기는 사람 수"다.
 */
export async function countBillableEmployees(companyId: string): Promise<number> {
  const [employees, admins] = await Promise.all([
    prisma.user.count({ where: { companyId, ...BILLABLE_EMPLOYEE_WHERE } }),
    prisma.user.count({ where: { companyId, ...HUMAN_ADMIN_WHERE } }),
  ]);
  return billableCount(employees, admins);
}

/** 순수 계산(검증용으로 따로 둔다). 음수·소수 입력은 0으로 본다. */
export function billableCount(employees: number, humanAdmins: number): number {
  const e = Number.isFinite(employees) ? Math.max(0, Math.floor(employees)) : 0;
  const a = Number.isFinite(humanAdmins) ? Math.max(0, Math.floor(humanAdmins)) : 0;
  return e + Math.max(0, a - FREE_ADMIN_COUNT);
}

/** 이 회사의 지금 요금. 인원 집계 + 구간 계산을 한 번에. */
export async function quoteForCompany(companyId: string): Promise<Quote> {
  return quoteFor(await countBillableEmployees(companyId));
}
