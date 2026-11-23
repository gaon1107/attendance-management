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
  operatorCancelBy: true, operatorCancelAt: true, periodRevertedAt: true, retryCount: true, lastCheckedAt: true,
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
  periodRevertedAt: Date | null;
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
  };
}
