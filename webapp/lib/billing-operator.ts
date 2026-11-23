// [운영자 결제 화면] 조회 — 2026-11-23 결제 6단계. 계획서 plan-근태결제-개발.md "6단계".
//
// 🔴 운영자 화면은 회사 칸막이를 넘어 **모든 회사의 결제**를 본다. 그래서 꺼내는 칸을 좁힌다:
//    회사 상호·사업자번호(주문서 복사본)·금액·상태·가린 카드번호·이용 기간만. 직원 이름·근태는 꺼내지 않는다.
//    빌키(bid)·상점키·거래번호 원문은 화면에 보내지 않는다(거래번호는 KIS 상점관리자에서 찾을 때 필요해 **끝 6자리만**).
// 🔴 서버 전용. 운영자 로그인 확인은 부르는 쪽(page.tsx·서버 액션)이 먼저 한다.
import { prisma } from "@/lib/db";
import { readKispgConfig } from "@/lib/kispg-config";
import { countHeads, billableCount } from "@/lib/pricing-server";
import { quoteFor } from "@/lib/pricing";
import { trialStatus } from "@/lib/trial";
import { getServiceAccess, type ServiceAccess } from "@/lib/service-access";
import { moveOrder, kisText } from "@/lib/pg-state";
import { claimCompany, releaseCompany, runNormalCancelFor } from "@/lib/billing-pay";
import { markCompanyCardsForDeletion, rescheduleCompanyCards, runBillingCancelFor, autoPayReady } from "@/lib/billing-auto";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 자동 정리가 멈추는 나이(billing-pay·billing-auto의 GIVE_UP_MS와 같은 7일). */
export const STUCK_DAYS = 7;
/** "승인됨 — 이용 기간 반영 재시도 중"이 이보다 오래 남으면 운영자 확인(정리는 10분마다 다시 반영한다). */
const APPLY_RETRY_ALERT_MS = HOUR_MS;
/** billing-pay.applyPaidOrder가 남기는 문구 — 이 글자로 "반영 재시도 중"을 찾는다(바꾸면 여기도 함께). */
export const APPLY_RETRY_REASON = "승인됨 — 이용 기간 반영 재시도 중";
/** billing-auto.settleBillingKeys가 남기는 문구의 앞부분 — 카드 등록 중 돈이 빠진 건(바꾸면 여기도 함께). */
export const REG_CHARGED_PREFIX = "카드 등록 중 결제가 승인되어";
export const OPERATOR_PAY_PAGE_SIZE = 50;

export const ORDER_STATUS_LABEL: Record<string, string> = {
  ready: "결제창 대기",
  check: "확인 중",
  paid: "결제 완료",
  failed: "실패",
  cancel_check: "취소 중",
  cancelled: "취소됨",
};
export const ORDER_TYPE_LABEL: Record<string, string> = {
  normal: "직접 결제",
  billing_first: "자동결제(첫 결제)",
  billing_auto: "자동결제",
};
export const KEY_STATUS_LABEL: Record<string, string> = {
  registering: "등록 창 열림",
  reg_check: "등록 확인 중",
  active: "사용 중",
  paused: "멈춤",
  deleting: "지우는 중",
  deleted: "지움",
  failed: "등록 실패",
};

export type PayFilter = "all" | "paid" | "pending" | "cancelled";
export const PAY_FILTERS: { key: PayFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "paid", label: "결제 완료" },
  { key: "pending", label: "확인 중·취소 중" },
  { key: "cancelled", label: "취소됨" },
];
export function parsePayFilter(v: unknown): PayFilter {
  return PAY_FILTERS.some((f) => f.key === v) ? (v as PayFilter) : "all";
}
const FILTER_STATUS: Record<PayFilter, string[]> = {
  // 결제창에서 돌아오지 않은 ready·실패(돈 안 빠짐)는 목록에서 뺀다 — 고객 화면 결제 내역(listPayments)과 같은 기준.
  all: ["paid", "check", "cancel_check", "cancelled"],
  paid: ["paid"],
  pending: ["check", "cancel_check"],
  cancelled: ["cancelled"],
};

/** 거래번호 끝 6자리 — KIS 상점관리자에서 찾을 때 쓴다(원문 전체는 화면에 보내지 않음). */
function tidTail(tid: string | null): string | null {
  return tid ? `…${tid.slice(-6)}` : null;
}

const ORDER_SELECT = {
  id: true, companyId: true, orderNo: true, orderType: true, productName: true, employees: true, totalAmount: true, pgAmount: true,
  status: true, paidAt: true, cancelledAt: true, periodStart: true, periodEnd: true, cardName: true, cardNoMasked: true,
  buyerName: true, buyerBizRegNo: true, failReason: true, createdAt: true, pgTid: true, pgMid: true,
  operatorCancelBy: true, operatorCancelAt: true, periodRevertedAt: true, retryCount: true, lastCheckedAt: true, prevPaidUntil: true,
} as const;

export type OperatorOrderRow = {
  id: string;
  companyId: string;
  companyName: string; // 지금 회사 이름(회사가 파기됐으면 주문서의 상호 복사본)
  companyGone: boolean; // 회사 행이 없다(해지 뒤 파기)
  orderNo: string;
  orderType: string;
  productName: string;
  employees: number;
  totalAmount: number;
  status: string;
  paidAt: Date | null;
  cancelledAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  card: string | null; // "가짜카드 1234-****-****-9999"
  buyerBizRegNo: string | null;
  failReason: string | null;
  createdAt: Date;
  tidTail: string | null;
  operatorCancelBy: string | null;
  operatorCancelAt: Date | null;
  periodRevertedAt: Date | null;
};

type RawOrder = {
  id: string; companyId: string; orderNo: string; orderType: string; productName: string; employees: number; totalAmount: number;
  status: string; paidAt: Date | null; cancelledAt: Date | null; periodStart: Date | null; periodEnd: Date | null;
  cardName: string | null; cardNoMasked: string | null; buyerName: string | null; buyerBizRegNo: string | null;
  failReason: string | null; createdAt: Date; pgTid: string | null; operatorCancelBy: string | null; operatorCancelAt: Date | null;
  periodRevertedAt: Date | null; prevPaidUntil: Date | null;
};

/** 주문 목록에 회사 이름을 붙인다 — 외래키가 없어(5년 보관) 회사 이름은 한 번에 따로 찾는다(N+1 없음). */
async function withCompanyNames(rows: RawOrder[]): Promise<OperatorOrderRow[]> {
  const ids = [...new Set(rows.map((r) => r.companyId))];
  const companies = ids.length
    ? await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const name = new Map(companies.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: r.id, companyId: r.companyId,
    companyName: name.get(r.companyId) ?? r.buyerName ?? "(알 수 없음)",
    companyGone: !name.has(r.companyId),
    orderNo: r.orderNo, orderType: r.orderType, productName: r.productName, employees: r.employees, totalAmount: r.totalAmount,
    status: r.status, paidAt: r.paidAt, cancelledAt: r.cancelledAt, periodStart: r.periodStart, periodEnd: r.periodEnd,
    card: [r.cardName, r.cardNoMasked].filter(Boolean).join(" ") || null,
    buyerBizRegNo: r.buyerBizRegNo, failReason: r.failReason, createdAt: r.createdAt, tidTail: tidTail(r.pgTid),
    operatorCancelBy: r.operatorCancelBy, operatorCancelAt: r.operatorCancelAt, periodRevertedAt: r.periodRevertedAt,
  }));
}

export type OperatorPayList = {
  rows: OperatorOrderRow[];
  total: number;
  page: number;
  pages: number;
  /** 이번 달(1일 0시~) 결제 완료 합계 — 취소된 건은 빠진다 */
  monthPaid: { count: number; amount: number };
};

/** 전체 회사 결제 목록(최근 것부터, 50개씩). q = 회사 이름(지금 이름 또는 주문서 상호) 일부. */
export async function listOperatorPayments(opts: { q: string; filter: PayFilter; page: number; now?: Date }): Promise<OperatorPayList> {
  const now = opts.now ?? new Date();
  const where: { status: { in: string[] }; OR?: ({ companyId: { in: string[] } } | { buyerName: { contains: string } })[] } = {
    status: { in: FILTER_STATUS[opts.filter] },
  };
  if (opts.q) {
    const matched = await prisma.company.findMany({ where: { name: { contains: opts.q } }, select: { id: true }, take: 200 });
    where.OR = [{ companyId: { in: matched.map((m) => m.id) } }, { buyerName: { contains: opts.q } }];
  }
  const total = await prisma.pgOrder.count({ where });
  const pages = Math.max(1, Math.ceil(total / OPERATOR_PAY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), pages);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [raw, month] = await Promise.all([
    prisma.pgOrder.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * OPERATOR_PAY_PAGE_SIZE, take: OPERATOR_PAY_PAGE_SIZE, select: ORDER_SELECT,
    }),
    prisma.pgOrder.aggregate({ where: { status: "paid", paidAt: { gte: monthStart } }, _count: { _all: true }, _sum: { totalAmount: true } }),
  ]);
  return {
    rows: await withCompanyNames(raw), total, page, pages,
    monthPaid: { count: month._count._all, amount: month._sum.totalAmount ?? 0 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 확인 필요 — 지금까지 서버 기록([운영자 확인 필요])에만 남던 것들을 화면에 모은다.
// ─────────────────────────────────────────────────────────────────────────────

export type AttentionKind = "stuck" | "apply_retry" | "mid_mismatch" | "not_reverted";
export const ATTENTION_LABEL: Record<AttentionKind, string> = {
  stuck: `${STUCK_DAYS}일 넘게 안 닫힘(자동 정리 멈춤)`,
  apply_retry: "돈은 빠졌는데 이용 기간이 안 늘어남(반영 재시도 중)",
  mid_mismatch: "상점ID가 지금 설정과 달라 조회 못 함",
  not_reverted: "취소됐지만 이용 기간을 되돌리지 못함",
};

export type AttentionOrder = OperatorOrderRow & { kinds: AttentionKind[] };
export type AttentionCard = {
  id: string; companyId: string; companyName: string; regNo: string; card: string | null; lastFailReason: string | null;
  createdAt: Date; amountHint: string | null;
};
export type Attention = { orders: AttentionOrder[]; cards: AttentionCard[]; total: number };

/**
 * 운영자가 직접 봐야 하는 결제·카드. 대상이 적어(정상 운영이면 0건) 조건마다 따로 찾아 합친다(각 100건 상한).
 *  · stuck: 확인 중·취소 중이 7일 넘음. 운영자 취소 건은 **취소를 누른 시각부터** 7일(한 달 전 결제를 취소해도 바로 뜨지 않게).
 *  · apply_retry: 확인 중 + "반영 재시도 중" 문구 + 승인 요청 뒤 1시간 넘음.
 *  · mid_mismatch: 확인 중·취소 중인데 주문의 상점ID가 지금 설정(일반·빌링)에 없다 → 자동 정리가 손을 못 댄다.
 *  · not_reverted: 결제 완료였다가 취소 확정됐는데(paidAt 있음) 이용 기간을 되돌리지 못한 것(10분 정리가 다시 시도 중이거나 뒤에 다른 결제가 있음).
 *  · 카드: 등록 중 결제가 승인된 카드(KIS 상점관리자에서 환불할 대상) 중 [환불함 표시]를 아직 안 한 것.
 */
export async function getAttention(now: Date = new Date()): Promise<Attention> {
  const stuckBefore = new Date(now.getTime() - STUCK_DAYS * DAY_MS);
  const cfg = readKispgConfig();
  const mids = [cfg.normal?.mid, cfg.billing?.mid].filter((m): m is string => !!m);
  const openStatus = { in: ["check", "cancel_check"] };
  const [stuck, retry, mismatch, notReverted, cards] = await Promise.all([
    prisma.pgOrder.findMany({
      where: {
        status: openStatus,
        OR: [
          { operatorCancelAt: null, createdAt: { lt: stuckBefore } },
          { operatorCancelAt: { lt: stuckBefore } },
        ],
      },
      select: ORDER_SELECT, take: 100, orderBy: { createdAt: "asc" },
    }),
    prisma.pgOrder.findMany({
      where: {
        status: "check", failReason: APPLY_RETRY_REASON,
        OR: [
          { approveRequestedAt: { lt: new Date(now.getTime() - APPLY_RETRY_ALERT_MS) } },
          { approveRequestedAt: null, createdAt: { lt: new Date(now.getTime() - APPLY_RETRY_ALERT_MS) } },
        ],
      },
      select: ORDER_SELECT, take: 100, orderBy: { createdAt: "asc" },
    }),
    // 결제 설정이 하나도 없으면(KIS 승인 전) 상점ID 비교가 뜻이 없다 — 그때는 모든 열린 주문이 "다름"으로 뜨므로 건너뛴다.
    mids.length
      ? prisma.pgOrder.findMany({ where: { status: openStatus, pgMid: { notIn: mids } }, select: ORDER_SELECT, take: 100, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.pgOrder.findMany({
      where: { status: "cancelled", paidAt: { not: null }, periodRevertedAt: null, cancelledAt: { lt: new Date(now.getTime() - 15 * 60 * 1000) } },
      select: ORDER_SELECT, take: 100, orderBy: { createdAt: "asc" },
    }),
    prisma.pgBillingKey.findMany({
      where: { status: "failed", lastFailReason: { startsWith: REG_CHARGED_PREFIX }, refundMarkedAt: null },
      select: { id: true, companyId: true, regNo: true, cardName: true, cardNoMasked: true, lastFailReason: true, createdAt: true, consentTotal: true },
      take: 100, orderBy: { createdAt: "asc" },
    }),
  ]);

  const kindsById = new Map<string, Set<AttentionKind>>();
  const rawById = new Map<string, RawOrder>();
  const add = (list: RawOrder[], kind: AttentionKind) => {
    for (const o of list) {
      rawById.set(o.id, o);
      const s = kindsById.get(o.id) ?? new Set<AttentionKind>();
      s.add(kind);
      kindsById.set(o.id, s);
    }
  };
  add(stuck, "stuck");
  add(retry, "apply_retry");
  add(mismatch, "mid_mismatch");
  add(notReverted, "not_reverted");
  const named = await withCompanyNames([...rawById.values()]);
  const orders = named
    .map((o) => ({ ...o, kinds: [...(kindsById.get(o.id) ?? [])] }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const cardCompanies = cards.length
    ? await prisma.company.findMany({ where: { id: { in: [...new Set(cards.map((c) => c.companyId))] } }, select: { id: true, name: true } })
    : [];
  const cname = new Map(cardCompanies.map((c) => [c.id, c.name]));
  const cardRows: AttentionCard[] = cards.map((k) => ({
    id: k.id, companyId: k.companyId, companyName: cname.get(k.companyId) ?? "(파기된 회사)", regNo: k.regNo,
    card: [k.cardName, k.cardNoMasked].filter(Boolean).join(" ") || null, lastFailReason: k.lastFailReason, createdAt: k.createdAt,
    // 등록 창에 보낸 금액(동의 금액) — 실제 빠진 금액은 KIS 상점관리자에서 확인한다
    amountHint: k.consentTotal ? `${k.consentTotal.toLocaleString("ko-KR")}원 안팎` : null,
  }));
  return { orders, cards: cardRows, total: orders.length + cardRows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 회사 상세의 "결제" 칸
// ─────────────────────────────────────────────────────────────────────────────

export type CompanyBilling = {
  trialEnd: Date; // 무료 체험 끝(이 시각 전까지 무료)
  paidUntil: Date | null; // 낸 이용 기간 끝
  usableUntil: Date; // max(체험 끝, 낸 기간 끝)
  access: ServiceAccess | null; // 미납 차단 판정(막히는 날 등)
  heads: { employees: number; admins: number; billable: number };
  quoteText: string; // "월 33,000원(부가세 포함) · 6~10명" / "요금 대상 없음" / "별도 협의"
  approvedTierIndex: number | null;
  card: { status: string; card: string | null; nextChargeDate: Date | null; failCount: number; lastFailReason: string | null } | null;
  orders: OperatorOrderRow[]; // 최근 20건(ready·실패 제외)
  /** [취소(환불)]을 보일 주문 id — 결제 완료 중 이 회사 이용 기간의 **맨 끝** 결제 하나뿐(규칙 2). 없으면 null */
  cancellableOrderId: string | null;
  /** 그 결제를 취소하면 돌아갈 이용 기간 끝(null = 결제 전 → 무료 기간 기준)과 자동결제 결제인지 — 확인 창 안내용 */
  cancelPreview: { revertTo: Date | null; autoPayOrder: boolean; amount: number } | null;
  /** 사용 중·멈춤 자동결제 카드가 있다 — "자동결제도 함께 해지" 체크를 보일지 */
  hasLiveCard: boolean;
  /** 취소를 막는 이유(가장 마지막 결제가 있는데도 못 할 때) — 화면 안내용 */
  cancelBlockedReason: string | null;
};

/** 화면 안내용 원 단위 표기. */
function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

export async function getCompanyBilling(companyId: string, now: Date = new Date()): Promise<CompanyBilling | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { createdAt: true, trialLastDate: true, paidUntil: true, approvedTierIndex: true },
  });
  if (!c) return null;
  const [heads, access, card, raw, open] = await Promise.all([
    countHeads(companyId),
    getServiceAccess(companyId, now),
    prisma.pgBillingKey.findFirst({
      where: { companyId, status: { in: ["active", "paused", "reg_check", "deleting"] } },
      orderBy: { createdAt: "desc" },
      select: { status: true, cardName: true, cardNoMasked: true, nextChargeDate: true, failCount: true, lastFailReason: true },
    }),
    prisma.pgOrder.findMany({
      where: { companyId, status: { in: ["paid", "check", "cancel_check", "cancelled"] } },
      orderBy: { createdAt: "desc" }, take: 20, select: ORDER_SELECT,
    }),
    prisma.pgOrder.count({ where: { companyId, status: { in: ["check", "cancel_check"] } } }),
  ]);
  const billable = billableCount(heads.employees, heads.admins);
  const q = quoteFor(billable);
  const quoteText =
    q.kind === "tier" ? `월 ${won(q.monthly + q.vat)}(부가세 포함) · ${q.label} 구간`
    : q.kind === "quote" ? "별도 협의 규모(카드 결제 불가)"
    : "요금 대상 인원 없음";
  const trialEnd = trialStatus(c.createdAt, now, c.trialLastDate).endsAt;
  const usableUntil = c.paidUntil && c.paidUntil > trialEnd ? c.paidUntil : trialEnd;

  // 취소할 수 있는 결제 = 결제 완료 중 기간 끝이 지금 회사의 paidUntil과 같은 것(= 맨 끝에 붙은 결제).
  const orders = await withCompanyNames(raw);
  const last = c.paidUntil ? raw.find((o) => o.status === "paid" && o.periodEnd && o.periodEnd.getTime() === c.paidUntil!.getTime()) : undefined;
  let cancellableOrderId: string | null = null;
  let cancelBlockedReason: string | null = null;
  if (last) {
    if (open > 0) cancelBlockedReason = "확인 중이거나 취소 중인 결제가 있어 지금은 취소할 수 없습니다. 그 결제가 닫힌 뒤 다시 해 주세요.";
    else if (!last.pgTid) cancelBlockedReason = "거래번호가 없는 결제라 이 화면에서 취소할 수 없습니다. KIS 상점관리자에서 확인해 주세요.";
    else cancellableOrderId = last.id;
  } else if (raw.some((o) => o.status === "paid")) {
    cancelBlockedReason = "이용 기간 끝에 붙은 결제가 없어 취소할 결제를 고를 수 없습니다(무료 기간 변경 등). 운영자 확인이 필요합니다.";
  }

  return {
    trialEnd, paidUntil: c.paidUntil, usableUntil, access,
    heads: { ...heads, billable }, quoteText, approvedTierIndex: c.approvedTierIndex,
    card: card ? { status: card.status, card: [card.cardName, card.cardNoMasked].filter(Boolean).join(" ") || null, nextChargeDate: card.nextChargeDate, failCount: card.failCount, lastFailReason: card.lastFailReason } : null,
    orders, cancellableOrderId, cancelBlockedReason,
    cancelPreview: cancellableOrderId && last ? { revertTo: last.prevPaidUntil, autoPayOrder: last.orderType !== "normal", amount: last.pgAmount ?? last.totalAmount } : null,
    hasLiveCard: !!card && (card.status === "active" || card.status === "paused"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 운영자 취소(환불) — 6-2. 사장님 결정(2026-11-23): 전액만 · 그 결제로 늘어난 이용 기간을 되돌림 ·
//  자동결제로 낸 결제면 "자동결제도 함께 해지"가 기본 · 고객 안내는 화면으로만.
//
//  흐름: 선점(payClaimUntil) → 다시 검사 → paid → cancel_check(운영자·시각 기록) → (선택) 자동결제 카드 내려놓기
//        → KIS 취소 1회 → 취소 확정이면 기간 되돌리기 → 선점 풀기.
//  · KIS 취소 결과를 모르면 cancel_check로 남는다. 10분 정리(reconcile + 아래 settleOperatorCancels)가 다시 취소하고,
//    확정되면 revertCancelledPeriods가 기간을 되돌린다. **기간은 돈이 돌아간 것이 확정된 뒤에만 되돌린다.**
//  · 취소 중(cancel_check)에는 그 회사의 새 결제가 막힌다(billing-pay blockReasonBeforeApprove·billing-auto chargeKey 기존 규칙).
// ─────────────────────────────────────────────────────────────────────────────

export type CancelResult = { ok: boolean; message: string; orderNo?: string; companyName?: string; amount?: number };

const CANCEL_REASON_MAX = 100;

/** "2026-12-31까지" — 이용 기간 끝(자정) 표시. 값이 없으면(첫 결제를 취소) 무료 기간으로 돌아간다. */
function untilText(end: Date | null): string {
  if (!end) return "결제 전 상태(무료 기간만)";
  const d = new Date(end.getTime() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}까지`;
}

export async function operatorCancelOrder(input: {
  orderId: string;
  companyId: string;
  reason: string;
  stopAutoPay: boolean;
  operator: { name: string; email: string };
}): Promise<CancelResult> {
  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, CANCEL_REASON_MAX);
  if (reason.length < 2) return { ok: false, message: "취소 사유를 2글자 이상 적어 주세요." };

  // 정기 청구·고객 결제와 겹치지 않게 회사 결제를 선점한다(SQLite에는 행 잠금이 없다 — 1단계 검수 M8).
  const token = await claimCompany(input.companyId, new Date());
  if (!token) return { ok: false, message: "이 회사의 결제를 지금 처리하고 있습니다. 1~2분 뒤 다시 해 주세요." };
  try {
    const o = await prisma.pgOrder.findUnique({ where: { id: input.orderId } });
    if (!o || o.companyId !== input.companyId) return { ok: false, message: "결제를 찾을 수 없습니다. 화면을 새로 고쳐 주세요." };
    if (o.status !== "paid") return { ok: false, message: "결제 완료 상태가 아니라 취소할 수 없습니다. 화면을 새로 고쳐 주세요." };
    if (!o.pgTid) return { ok: false, message: "거래번호가 없는 결제라 이 화면에서 취소할 수 없습니다. KIS 상점관리자에서 확인해 주세요." };
    const company = await prisma.company.findUnique({ where: { id: o.companyId }, select: { name: true, paidUntil: true } });
    if (!company) return { ok: false, message: "회사 정보가 없어(파기됨) 이 화면에서 취소할 수 없습니다. KIS 상점관리자에서 처리해 주세요." };
    // 규칙 2 — 이용 기간 맨 끝에 붙은 결제만(가운데를 빼면 뒤 결제의 기간이 꼬인다).
    if (!o.periodEnd || !company.paidUntil || company.paidUntil.getTime() !== o.periodEnd.getTime()) {
      return { ok: false, message: "이 결제 뒤에 늘어난 이용 기간이 있어 취소할 수 없습니다. 가장 마지막 결제부터 취소해 주세요." };
    }
    const open = await prisma.pgOrder.count({ where: { companyId: o.companyId, id: { not: o.id }, status: { in: ["check", "cancel_check"] } } });
    if (open > 0) return { ok: false, message: "이 회사에 확인 중이거나 취소 중인 결제가 있어 지금은 취소할 수 없습니다. 그 결제가 닫힌 뒤 다시 해 주세요." };
    // 지금 설정으로 취소 요청을 보낼 수 있는지 먼저 본다 — 못 보내는데 취소 중으로 바꾸면 "취소 중"에 갇힌다.
    const cfg = readKispgConfig();
    const canSend = o.orderType === "normal" ? cfg.normal?.mid === o.pgMid : cfg.billing?.mid === o.pgMid && autoPayReady();
    if (!canSend) return { ok: false, message: "이 결제를 보낸 상점 설정이 지금 서버에 없어 취소 요청을 보낼 수 없습니다. KIS 상점관리자에서 처리해 주세요." };

    const now = new Date();
    const by = `${input.operator.name} <${input.operator.email}>`.slice(0, 120);
    const moved = await moveOrder(prisma, o.id, ["paid"], "cancel_check", {
      failReason: kisText(`운영자 취소: ${reason}`),
      operatorCancelBy: by,
      operatorCancelAt: now,
      // 방금 만진 주문 — 10분 정리가 같은 순간 같은 주문을 또 취소하러 오지 않게(조회 잠금 120초와 같은 칸).
      lastCheckedAt: now,
    });
    if (!moved) return { ok: false, message: "그사이 다른 처리가 먼저 있었습니다. 화면을 새로 고쳐 주세요." };

    // 자동결제도 함께 해지(사장님 결정 3) — 안 그러면 취소로 풀린 회차가 다음 날 아침 다시 청구된다.
    let cardsStopped = 0;
    if (input.stopAutoPay) {
      try {
        cardsStopped = await markCompanyCardsForDeletion(o.companyId, `운영자가 결제를 취소하며 자동결제 해지 — ${reason}`);
      } catch (e) {
        console.error(`[billing-operator] [운영자 확인 필요] 결제 취소 중 자동결제 해지 실패 — 주문 ${o.orderNo}: ${e instanceof Error ? e.name : "unknown"}`);
      }
    }

    // KIS 취소 1회. 실패·결과 모름이면 cancel_check로 남아 10분 정리가 다시 한다.
    try {
      if (o.orderType === "normal") await runNormalCancelFor(o.id);
      else await runBillingCancelFor(o.id);
    } catch (e) {
      console.error(`[billing-operator] 운영자 취소 요청 오류(10분 정리가 다시 시도) — 주문 ${o.orderNo}: ${e instanceof Error ? e.name : "unknown"}`);
    }
    const after = await prisma.pgOrder.findUnique({ where: { id: o.id }, select: { status: true } });
    const stopText = input.stopAutoPay ? (cardsStopped > 0 ? " 자동결제도 해지했습니다." : " (해지할 자동결제 카드는 없었습니다.)") : "";
    const amount = o.pgAmount ?? o.totalAmount;
    const base = { orderNo: o.orderNo, companyName: company.name, amount };
    if (after?.status === "cancelled") {
      const r = await revertOne(o.id);
      const periodText = r === "reverted"
        ? ` 이용 기간을 ${untilText(o.prevPaidUntil)}로 되돌렸습니다.`
        : " ⚠️ 이용 기간은 되돌리지 못했습니다 — [결제] 확인 필요 칸을 봐 주세요.";
      return { ok: true, message: `${amount.toLocaleString("ko-KR")}원을 취소(환불)했습니다.${periodText}${stopText}`, ...base };
    }
    return {
      ok: true,
      message: `취소를 요청했지만 KIS 결과를 아직 모릅니다. 10분마다 다시 확인하며, 취소가 확정되면 이용 기간이 되돌아갑니다.${stopText}`,
      ...base,
    };
  } finally {
    await releaseCompany(input.companyId, token);
  }
}

/**
 * 결제 완료였다가 취소가 **확정된** 주문 하나의 이용 기간을 되돌린다(paidUntil = prevPaidUntil).
 *  · 회사의 지금 이용 기간 끝이 이 주문의 끝과 같을 때만(그 뒤에 다른 결제가 붙었으면 손대지 않고 운영자 확인 목록에 남긴다).
 *  · 회사 행이 없으면(파기) 되돌릴 것이 없으니 끝난 것으로 표시한다.
 *  · 되돌린 뒤 자동결제 카드의 다음 결제일을 다시 계산한다(3단계에서 넘긴 일).
 */
async function revertOne(orderId: string): Promise<"reverted" | "gone" | "mismatch" | "skip"> {
  const r = await prisma.$transaction(async (tx) => {
    const o = await tx.pgOrder.findUnique({
      where: { id: orderId },
      select: { id: true, companyId: true, status: true, paidAt: true, periodEnd: true, prevPaidUntil: true, periodRevertedAt: true, orderNo: true },
    });
    if (!o || o.status !== "cancelled" || !o.paidAt || o.periodRevertedAt) return { kind: "skip" as const };
    const c = await tx.company.findUnique({ where: { id: o.companyId }, select: { paidUntil: true } });
    const now = new Date();
    if (!c) {
      await tx.pgOrder.updateMany({ where: { id: o.id, periodRevertedAt: null }, data: { periodRevertedAt: now } });
      return { kind: "gone" as const };
    }
    if (!o.periodEnd || !c.paidUntil || c.paidUntil.getTime() !== o.periodEnd.getTime()) return { kind: "mismatch" as const, orderNo: o.orderNo };
    // 읽은 값 그대로일 때만(그사이 다른 결제가 기간을 늘렸으면 손대지 않는다).
    const changed = await tx.company.updateMany({ where: { id: o.companyId, paidUntil: o.periodEnd }, data: { paidUntil: o.prevPaidUntil } });
    if (changed.count !== 1) return { kind: "mismatch" as const, orderNo: o.orderNo };
    await tx.pgOrder.updateMany({ where: { id: o.id, periodRevertedAt: null }, data: { periodRevertedAt: now } });
    return { kind: "reverted" as const, companyId: o.companyId };
  });
  if (r.kind === "mismatch") {
    warnOnce(`revert:${orderId}`, `[billing-operator] [운영자 확인 필요] 취소된 결제 ${r.orderNo}의 이용 기간을 되돌리지 못함 — 뒤에 다른 결제가 있거나 기간이 바뀜`);
  }
  if (r.kind === "reverted") {
    try {
      await rescheduleCompanyCards(r.companyId);
    } catch (e) {
      console.error(`[billing-operator] [운영자 확인 필요] 기간 되돌린 뒤 자동결제 결제일 다시 계산 실패(ID ${r.companyId.slice(0, 8)}): ${e instanceof Error ? e.name : "unknown"}`);
    }
  }
  return r.kind;
}

// 되돌리지 못한 건은 10분마다 다시 보는데, 같은 경고를 서버가 켜진 동안 한 번만 남긴다(기록이 쌓이지 않게).
const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  if (warned.size > 500) warned.clear();
  warned.add(key);
  console.error(msg);
}

/** 취소가 확정됐는데 아직 기간을 되돌리지 않은 주문을 처리한다(10분 정리·운영자 처리에서 부른다). */
export async function revertCancelledPeriods(limit = 20): Promise<number> {
  const list = await prisma.pgOrder.findMany({
    where: { status: "cancelled", paidAt: { not: null }, periodRevertedAt: null },
    orderBy: { cancelledAt: "asc" }, take: limit, select: { id: true },
  });
  let n = 0;
  for (const o of list) {
    try {
      if ((await revertOne(o.id)) === "reverted") n++;
    } catch (e) {
      console.error(`[billing-operator] 이용 기간 되돌리기 오류(다음 정리 때 다시) — 주문 ${o.id}: ${e instanceof Error ? e.name : "unknown"}`);
    }
  }
  return n;
}

/** 운영자 취소 다시 시도 간격 — 10분 정리마다 한 번(조회 잠금 120초보다 길게). */
const OPERATOR_RETRY_MS = 9 * 60 * 1000;

/**
 * 10분 정리(lib/scheduled-jobs.ts) — 운영자가 누른 취소 중 아직 안 끝난 것을 다시 취소하고, 확정된 것의 기간을 되돌린다.
 *  · 결제 정리(reconcile)는 "결제한 지 7일"이 지나면 손을 떼므로, 한 달 전 결제를 운영자가 취소하면 거기서는 다시 시도하지 않는다.
 *    그래서 운영자 취소 건은 **취소를 누른 시각부터 7일** 동안 여기서 다시 시도한다(같은 조회 잠금 칸을 써서 겹치지 않음).
 */
export async function settleOperatorCancels(now: Date = new Date()): Promise<{ retried: number; reverted: number }> {
  const giveUpBefore = new Date(now.getTime() - STUCK_DAYS * DAY_MS);
  const list = await prisma.pgOrder.findMany({
    where: {
      status: "cancel_check", operatorCancelAt: { gte: giveUpBefore },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - OPERATOR_RETRY_MS) } }],
    },
    orderBy: { lastCheckedAt: "asc" }, take: 20,
    select: { id: true, orderNo: true, orderType: true, lastCheckedAt: true },
  });
  let retried = 0;
  for (const o of list) {
    const locked = await prisma.pgOrder.updateMany({
      where: { id: o.id, status: "cancel_check", lastCheckedAt: o.lastCheckedAt },
      data: { lastCheckedAt: new Date(), retryCount: { increment: 1 } },
    });
    if (locked.count !== 1) continue;
    retried++;
    try {
      const sent = o.orderType === "normal" ? await runNormalCancelFor(o.id) : await runBillingCancelFor(o.id);
      if (!sent) warnOnce(`send:${o.id}`, `[billing-operator] [운영자 확인 필요] 운영자 취소 ${o.orderNo} — 상점 설정이 없어 취소 요청을 보내지 못함`);
    } catch (e) {
      console.error(`[billing-operator] 운영자 취소 재시도 오류 — 주문 ${o.orderNo}: ${e instanceof Error ? e.name : "unknown"}`);
    }
  }
  const reverted = await revertCancelledPeriods();
  return { retried, reverted };
}
