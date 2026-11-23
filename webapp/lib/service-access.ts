// [미납 차단] 이용 기간이 끝나고 유예 3일이 지나면 직원의 **새 출근·외출 시작**만 막는다 — 2026-11-23 결제 5단계.
//   계획서 plan-근태결제-개발.md "5단계", 차단 범위 근거 lib/trial.ts 머리말(사장님 결정 2026-08-09·11-20·11-23).
//
// 사장님 결정
//  · 막는 것: 직원의 새 출근(웹·얼굴·위치)과 외출 시작. **이미 시작한 근무의 퇴근과 외출 복귀는 허용**(11-23 — 퇴근까지 막으면
//    법정 근로기록이 "퇴근 안 함"으로 틀어진다).
//  · 막지 않는 것: 관리자의 모든 기능, 직원의 휴가·정정 신청과 조회, 근로기록 조회·엑셀(3년 보존은 사업주의 법적 의무).
//  · 유예 3일(11-23). 시연 회사(isDemo)는 막지 않는다. PC 프로그램(PC-OFF)은 출퇴근 기록을 만들지 않아 대상이 아니다.
//
// 🔴 안전장치 — "돈 낼 방법이 없거나, 돈을 냈는지 모를 때는 막지 않는다"(8/9 결정의 이유: 결제 수단 없이 막으면 회사 근태가 통째로 멈춘다).
//  ① 결제 개시일(BILLING_ENFORCE_FROM, YYYY-MM-DD)이 있고 **카드 결제 설정(KIS)도 살아 있을 때만** 작동(5단계 검수 중간 1-a).
//  ② 개시일이 ENFORCE_FLOOR보다 이르면 오타로 보고 끈다 — 과거 날짜를 잘못 넣으면 유예 없이 전 회사가 즉시 막힌다(검수 중간 1-b).
//  ③ 이미 기간이 끝난 회사도 "결제 개시일 + 3일"까지는 막지 않는다 — 개시일 아침에 갑자기 막히지 않게.
//  ④ **확인 중인 결제(돈이 빠졌는지 모름 · 환불 진행 중)가 있으면 막지 않는다**(검수 치명 1) — 결제 직후 결과 모름이면 이용 기간이
//     안 늘어난 채 다시 결제도 막혀(확인 중 결제가 있으면 새 결제 거절) 스스로 풀 방법이 없었다.
//  ⑤ **카드로 결제할 수 없는 회사는 막지 않는다**(검수 중간 2) — 요금표를 넘는 규모(별도 협의)·카드 1회 한도 초과. 운영자가 처리한다.
//     **요금 대상 0명 회사도 막지 않는다**(재확인 중간 1) — 낼 돈이 없어 결제가 거절되므로 스스로 풀 방법이 없다.
//  ⑥ 판단이 실패하면(DB 오류·날짜 값 깨짐) 막지 않는다.
//
// 순수 계산(computeServiceAccess)과 DB 읽기를 나눈 이유: 테스트 러너가 없어 임시 라우트로 경계값을 검증한다(webapp/CLAUDE.md).
import { prisma } from "@/lib/db";
import { trialStatus } from "@/lib/trial";
import { readKispgConfig } from "@/lib/kispg-config";
import { quoteForCompany } from "@/lib/pricing-server";
import { KIS_MAX_TOTAL } from "@/lib/pricing";

/** 이용 기간이 끝난 뒤 직원 출퇴근을 막기까지의 유예 일수(사장님 결정 11-23). 화면 문구도 이 값을 쓴다. */
export const GRACE_DAYS = 3;
/**
 * 가온 운영자가 결제를 취소(환불)한 날부터 직원 출근을 막지 않는 일수(사장님 결정 2026-11-23).
 *  환불하면 그 결제로 늘어난 기간이 되돌아가 유예 3일도 이미 지난 상태가 되기 쉽다 — 기간 중간에 회사 잘못으로 환불한 고객이
 *  다음 날 아침 출근부터 막히는 일을 없앤다. 막는 날 = max(원래 막는 날, 환불한 날 0시 + 이 일수). 그 안에 다시 결제하거나 정리하면 된다.
 */
export const REFUND_GRACE_DAYS = 7;
/** 관리자 첫 화면에 "곧 끝남" 띠를 띄우기 시작하는 날 수. */
export const WARN_DAYS = 7;
/** 결제 개시일로 받는 가장 이른 날 — 이보다 이르면 오타로 보고 차단을 끈다(5단계를 만든 날). */
const ENFORCE_FLOOR = new Date(2026, 10, 23); // 2026-11-23 0시
const DAY_MS = 24 * 60 * 60 * 1000;

/** 막지 않고 열어 둔 이유(막는 날이 지났는데도). */
export type Hold = "payment_pending" | "card_unavailable" | "nothing_to_pay";

export type ServiceAccess =
  /** 정상 이용 중(끝나려면 WARN_DAYS보다 많이 남음) */
  | { kind: "ok"; usableUntil: Date; enforced: boolean }
  /** 곧 끝남(WARN_DAYS 이내) — 아직 아무것도 막지 않는다. blockAt = 결제 없을 때 막을 날(차단이 꺼져 있으면 null) */
  | { kind: "ending"; usableUntil: Date; daysLeft: number; blockAt: Date | null; enforced: boolean }
  /** 이용 기간은 끝났지만 막지 않는 중 — 유예 중(blockAt 앞)이거나, 차단 꺼짐(blockAt null), 또는 hold(확인 중 결제·카드 결제 불가) */
  | { kind: "grace"; usableUntil: Date; blockAt: Date | null; enforced: boolean; hold: Hold | null }
  /** 막힘 — 직원의 새 출근·외출 시작 불가 */
  | { kind: "blocked"; usableUntil: Date; blockAt: Date; enforced: true }
  /** 시연 회사 — 막지 않는다 */
  | { kind: "demo" }
  /** 판단할 수 없음(날짜 값 깨짐) — 막지 않는다 */
  | { kind: "unknown" };

// 같은 경고는 서버가 켜진 동안 한 번만(요청마다 쌓이지 않게 — 검수 경미 8). 회사별 경고가 번갈아 반복되지 않게 여러 개를 기억한다.
const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  if (warned.size > 500) warned.clear(); // 무한히 커지지 않게
  warned.add(key);
  console.error(msg);
}

/** 결제 개시일(그날 0시, 한국 시각). 없거나 형식이 틀리거나 ENFORCE_FLOOR보다 이르면 null — 그러면 아무도 막지 않는다. */
export function readEnforceFrom(raw: string | undefined = process.env.BILLING_ENFORCE_FROM): Date | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) {
    warnOnce(v, "[service-access] BILLING_ENFORCE_FROM 형식이 틀립니다(YYYY-MM-DD). 미납 차단을 끈 상태로 둡니다.");
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
    warnOnce(v, "[service-access] BILLING_ENFORCE_FROM이 없는 날짜입니다. 미납 차단을 끈 상태로 둡니다.");
    return null;
  }
  if (d.getTime() < ENFORCE_FLOOR.getTime()) {
    warnOnce(v, `[service-access] BILLING_ENFORCE_FROM(${v})이 너무 이른 날짜라 오타로 보고 미납 차단을 끈 상태로 둡니다(${ENFORCE_FLOOR.toLocaleDateString("ko-KR")} 이후만).`);
    return null;
  }
  return d;
}

const bad = (d: Date | null | undefined) => d instanceof Date && Number.isNaN(d.getTime());

/**
 * 순수 계산. 이용 가능 끝 = max(무료 기간 끝, 결제한 기간 끝). 막는 날 = max(이용 가능 끝, 결제 개시일) + 유예 3일.
 *  · 모든 경계는 0시(끝 시각은 "그 시각 **전까지** 이용"). 막는 날 0시부터 막는다.
 *  · hold: 막는 날이 지났어도 막지 않을 이유(확인 중 결제·카드 결제 불가) — 있으면 grace로 돌려준다.
 *  · notBefore: 이 시각 전에는 막지 않는다(운영자 환불 뒤 여유 — REFUND_GRACE_DAYS). 막는 날을 이 시각까지 미룬다.
 */
export function computeServiceAccess(
  c: { createdAt: Date; trialLastDate: Date | null; paidUntil: Date | null; isDemo: boolean },
  now: Date,
  enforceFrom: Date | null,
  hold: Hold | null = null,
  notBefore: Date | null = null
): ServiceAccess {
  if (c.isDemo) return { kind: "demo" };
  if (bad(c.createdAt) || bad(c.trialLastDate) || bad(c.paidUntil) || bad(enforceFrom) || bad(now) || bad(notBefore)) return { kind: "unknown" };
  const trialEnd = trialStatus(c.createdAt, now, c.trialLastDate).endsAt;
  if (bad(trialEnd)) return { kind: "unknown" };
  const usableUntil = c.paidUntil && c.paidUntil.getTime() > trialEnd.getTime() ? c.paidUntil : trialEnd;
  const enforced = enforceFrom !== null;
  let blockAt: Date | null = null;
  if (enforceFrom) {
    blockAt = new Date(Math.max(usableUntil.getTime(), enforceFrom.getTime()));
    blockAt.setDate(blockAt.getDate() + GRACE_DAYS); // 날짜 단위로 더한다(서머타임 없는 한국 시각 — 0시 유지)
    if (notBefore && notBefore.getTime() > blockAt.getTime()) blockAt = new Date(notBefore);
  }
  if (now.getTime() < usableUntil.getTime()) {
    const daysLeft = Math.ceil((usableUntil.getTime() - now.getTime()) / DAY_MS);
    return daysLeft <= WARN_DAYS ? { kind: "ending", usableUntil, daysLeft, blockAt, enforced } : { kind: "ok", usableUntil, enforced };
  }
  if (!blockAt || now.getTime() < blockAt.getTime()) return { kind: "grace", usableUntil, blockAt, enforced, hold: null };
  if (hold) return { kind: "grace", usableUntil, blockAt, enforced: true, hold };
  return { kind: "blocked", usableUntil, blockAt, enforced: true };
}

/** 지금 서버에서 차단이 켜져 있는가(결제 개시일 + 카드 결제 설정 둘 다). 켜져 있으면 개시일, 아니면 null. */
export function activeEnforceFrom(): Date | null {
  const from = readEnforceFrom();
  if (!from) return null;
  if (!readKispgConfig().normal) {
    warnOnce("no-kis", "[service-access] BILLING_ENFORCE_FROM은 있지만 카드 결제 설정(KISPG_*)이 없어 미납 차단을 끈 상태로 둡니다.");
    return null;
  }
  return from;
}

/** 막는 날이 지났을 때만 부른다 — 막지 않을 이유가 있는가(확인 중 결제 · 카드로 낼 수 없는 회사). */
async function holdReason(companyId: string): Promise<Hold | null> {
  const pending = await prisma.pgOrder.count({ where: { companyId, status: { in: ["check", "cancel_check"] } } });
  if (pending > 0) return "payment_pending";
  const q = await quoteForCompany(companyId);
  if (q.kind === "none") return "nothing_to_pay"; // 요금 대상 0명 — 결제가 거절되니 막지 않는다(재확인 중간 1)
  const max = readKispgConfig().maxAmount ?? KIS_MAX_TOTAL;
  if (q.kind === "quote" || (q.kind === "tier" && q.total > max)) {
    warnOnce(`card:${companyId}`, `[service-access] [운영자 확인 필요] 회사 ${companyId.slice(0, 8)} — 카드로 결제할 수 없는 규모인데 이용 기간이 끝나 차단 보류 중`);
    return "card_unavailable";
  }
  return null;
}

/**
 * 최근 운영자 환불(취소) 뒤 막지 않는 끝 시각 = 환불한 날 0시 + REFUND_GRACE_DAYS. 해당 없으면 null.
 *  · 환불한 날 = 운영자가 취소를 요청한 날과 KIS 취소가 확정된 날 중 **늦은 날**(확정이 며칠 늦어도 여유가 줄지 않게).
 *  · 취소 중(cancel_check)인 건도 센다 — 그동안은 payment_pending으로도 막지 않지만, 화면에 막는 날을 바르게 보이려고.
 *  · [결제 완료로 되돌리기](KIS 취소 거절)는 operatorCancelAt을 비우므로 여기서 빠진다(환불이 아니었다).
 */
async function refundGraceUntil(companyId: string, now: Date): Promise<Date | null> {
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - REFUND_GRACE_DAYS);
  const rows = await prisma.pgOrder.findMany({
    where: {
      companyId,
      status: { in: ["cancel_check", "cancelled"] },
      operatorCancelAt: { not: null },
      OR: [{ operatorCancelAt: { gte: since } }, { cancelledAt: { gte: since } }],
    },
    select: { operatorCancelAt: true, cancelledAt: true },
    orderBy: { operatorCancelAt: "desc" },
    take: 20,
  });
  let latest = 0;
  for (const r of rows) {
    for (const d of [r.operatorCancelAt, r.cancelledAt]) {
      if (d && !Number.isNaN(d.getTime()) && d.getTime() > latest) latest = d.getTime();
    }
  }
  if (!latest) return null;
  const until = new Date(latest);
  until.setHours(0, 0, 0, 0);
  until.setDate(until.getDate() + REFUND_GRACE_DAYS);
  return until;
}

/** 이 회사의 지금 이용 상태(화면·차단 공용). 회사가 없으면 null. */
export async function getServiceAccess(companyId: string, now: Date = new Date()): Promise<ServiceAccess | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { createdAt: true, trialLastDate: true, paidUntil: true, isDemo: true },
  });
  if (!c) return null;
  const from = activeEnforceFrom();
  const first = computeServiceAccess(c, now, from);
  // 곧 끝나거나 이미 끝난 회사만 더 본다 — 차단이 꺼져 있거나 남은 기간이 WARN_DAYS(7)보다 많으면(ok) 환불 여유가 막는 날을 바꿀 수 없다.
  //  ending도 본다: 환불로 되돌린 기간이 며칠 남은 경우 여유를 뺀 이른 날짜를 안내하지 않게(검수 중간 1).
  if (!from || (first.kind !== "ending" && first.kind !== "grace" && first.kind !== "blocked")) return first;
  let notBefore: Date | null = null;
  try {
    notBefore = await refundGraceUntil(companyId, now);
  } catch (e) {
    // 조회 실패 = 여유 없음으로 본다(예전과 같은 결과). 화면 전체를 실패시키지 않는다(검수 중간 2).
    console.error("[service-access] 환불 여유 조회 실패 — 여유 없이 판단:", e instanceof Error ? e.name : "unknown");
  }
  const second = notBefore ? computeServiceAccess(c, now, from, null, notBefore) : first;
  if (second.kind !== "blocked") return second;
  return computeServiceAccess(c, now, from, await holdReason(companyId), notBefore);
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
