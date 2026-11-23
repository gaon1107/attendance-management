// [미납 차단] 이용 기간이 끝나고 유예 3일이 지나면 직원의 **새 출근·외출 시작**만 막는다 — 2026-11-23 결제 5단계.
//   계획서 plan-근태결제-개발.md "5단계", 차단 범위 근거 lib/trial.ts 머리말(사장님 결정 2026-08-09·11-20·11-23).
//
// 사장님 결정
//  · 막는 것: 직원의 새 출근(웹·얼굴·위치)과 외출 시작. **이미 시작한 근무의 퇴근과 외출 복귀는 허용**(11-23 — 퇴근까지 막으면
//    법정 근로기록이 "퇴근 안 함"으로 틀어진다).
//  · 막지 않는 것: 관리자의 모든 기능, 직원의 휴가·정정 신청과 조회, 근로기록 조회·엑셀(3년 보존은 사업주의 법적 의무).
//  · 유예 3일(11-23). 시연 회사(isDemo)는 막지 않는다. PC 프로그램(PC-OFF)은 출퇴근 기록을 만들지 않아 대상이 아니다.
//
// 🔴 안전장치 — **결제 개시 전에는 아무도 막지 않는다.** 서버 설정 BILLING_ENFORCE_FROM(결제 개시일 YYYY-MM-DD)이 있어야만 작동한다.
//    8/9 결정의 이유 그대로: 결제 수단 없이 막으면 고객이 돈을 낼 방법도 없이 회사 근태가 통째로 멈춘다.
//    이미 기간이 끝난 회사도 "결제 개시일 + 3일"까지는 막지 않는다 — 개시일 아침에 갑자기 막히지 않게.
//
// 순수 계산(computeServiceAccess)과 DB 읽기를 나눈 이유: 테스트 러너가 없어 임시 라우트로 경계값을 검증한다(webapp/CLAUDE.md).
import { prisma } from "@/lib/db";
import { trialStatus } from "@/lib/trial";

/** 이용 기간이 끝난 뒤 직원 출퇴근을 막기까지의 유예 일수(사장님 결정 11-23). 화면 문구도 이 값을 쓴다. */
export const GRACE_DAYS = 3;
/** 관리자 첫 화면에 "곧 끝남" 띠를 띄우기 시작하는 날 수. */
export const WARN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ServiceAccess =
  /** 정상 이용 중(끝나려면 WARN_DAYS보다 많이 남음) */
  | { kind: "ok"; usableUntil: Date; enforced: boolean }
  /** 곧 끝남(WARN_DAYS 이내) — 아직 아무것도 막지 않는다 */
  | { kind: "ending"; usableUntil: Date; daysLeft: number; enforced: boolean }
  /** 이용 기간은 끝났지만 유예 중(막는 날 전) — enforced=false면 결제 개시 전이라 막는 날이 정해지지 않음 */
  | { kind: "grace"; usableUntil: Date; blockAt: Date | null; enforced: boolean }
  /** 막힘 — 직원의 새 출근·외출 시작 불가 */
  | { kind: "blocked"; usableUntil: Date; blockAt: Date; enforced: true }
  /** 시연 회사 — 막지 않는다 */
  | { kind: "demo" };

/** 결제 개시일(그날 0시, 한국 시각). 없거나 형식이 틀리면 null — 그러면 아무도 막지 않는다. */
export function readEnforceFrom(raw: string | undefined = process.env.BILLING_ENFORCE_FROM): Date | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) {
    console.error("[service-access] BILLING_ENFORCE_FROM 형식이 틀립니다(YYYY-MM-DD). 미납 차단을 끈 상태로 둡니다.");
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    console.error("[service-access] BILLING_ENFORCE_FROM이 없는 날짜입니다. 미납 차단을 끈 상태로 둡니다.");
    return null;
  }
  return d;
}

/**
 * 순수 계산. 이용 가능 끝 = max(무료 기간 끝, 결제한 기간 끝). 막는 날 = max(이용 가능 끝, 결제 개시일) + 유예 3일.
 *  · 모든 경계는 0시(끝 시각은 "그 시각 **전까지** 이용"). 막는 날 0시부터 막는다.
 */
export function computeServiceAccess(
  c: { createdAt: Date; trialLastDate: Date | null; paidUntil: Date | null; isDemo: boolean },
  now: Date,
  enforceFrom: Date | null
): ServiceAccess {
  if (c.isDemo) return { kind: "demo" };
  const trialEnd = trialStatus(c.createdAt, now, c.trialLastDate).endsAt;
  const usableUntil = c.paidUntil && c.paidUntil.getTime() > trialEnd.getTime() ? c.paidUntil : trialEnd;
  const enforced = enforceFrom !== null;
  if (now.getTime() < usableUntil.getTime()) {
    const daysLeft = Math.ceil((usableUntil.getTime() - now.getTime()) / DAY_MS);
    return daysLeft <= WARN_DAYS ? { kind: "ending", usableUntil, daysLeft, enforced } : { kind: "ok", usableUntil, enforced };
  }
  if (!enforceFrom) return { kind: "grace", usableUntil, blockAt: null, enforced: false };
  const start = Math.max(usableUntil.getTime(), enforceFrom.getTime());
  const blockAt = new Date(start);
  blockAt.setDate(blockAt.getDate() + GRACE_DAYS); // 날짜 단위로 더한다(서머타임 없는 한국 시각 — 0시 유지)
  if (now.getTime() < blockAt.getTime()) return { kind: "grace", usableUntil, blockAt, enforced: true };
  return { kind: "blocked", usableUntil, blockAt, enforced: true };
}

/** 이 회사의 지금 이용 상태(화면·차단 공용). 회사가 없으면 null. */
export async function getServiceAccess(companyId: string, now: Date = new Date()): Promise<ServiceAccess | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { createdAt: true, trialLastDate: true, paidUntil: true, isDemo: true },
  });
  if (!c) return null;
  return computeServiceAccess(c, now, readEnforceFrom());
}

/** 직원 화면·서버 동작에 보일 안내(막혔을 때). */
export const CLOCK_BLOCKED_MESSAGE =
  "회사의 서비스 이용 기간이 끝나 출근·외출을 기록할 수 없습니다. 회사 관리자에게 문의해 주세요. (이미 시작한 근무의 퇴근·복귀는 할 수 있습니다)";

/**
 * 새 출근·외출 시작을 막아야 하면 안내 문구, 아니면 null.
 *  🔴 판단이 실패하면(DB 오류 등) **막지 않는다** — 차단 판단 오류로 회사 전 직원의 출근이 멈추는 쪽이 훨씬 큰 사고다.
 */
export async function clockStartBlockReason(companyId: string): Promise<string | null> {
  try {
    const a = await getServiceAccess(companyId);
    return a?.kind === "blocked" ? CLOCK_BLOCKED_MESSAGE : null;
  } catch (e) {
    console.error("[service-access] 이용 상태 확인 실패 — 막지 않고 진행:", e instanceof Error ? e.name : "unknown");
    return null;
  }
}
