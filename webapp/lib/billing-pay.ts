// [구독 월 결제] 주문서 만들기 → KIS 결제창 결과 받기 → 승인 → 이용 기간 1개월 연장 → 결과 모름 정리
//   2026-11-23 결제 2단계. 계획서 plan-근태결제-개발.md / 요금 규칙 plan-구독결제-요금제.md
//
// 규칙은 학원관리 연결부(newgaon-LMS backend/services/subscriptionPayService.js)를 본떴다. 그 코드는 MySQL 행 잠금·
// LMS- 주문번호·학원 표에 묶여 있어 그대로 쓰지 않고, 아래 원칙만 옮겼다:
//   ① 금액·회사는 **언제나 DB 주문서에서** 꺼낸다. 결제창에서 돌아온 값(ordNo·amt)은 주문서를 찾는 열쇠로만 쓴다.
//   ② 승인 결과가 애매하면(uncertain) **실패로 단정하지 않는다** → check로 두고 10분 정리가 KIS 조회로 닫는다.
//      "돈이 안 빠졌다"고 보는 것은 조회가 not_found일 때뿐이고, 그것도 주문 후 60분이 지난 뒤.
//   ③ 승인 금액이 주문 금액과 다르면 **즉시 취소**한다(그 금액으로).
//   ④ 이용 기간 반영이 실패하면 **즉시 취소**한다(돈만 빠지고 기간이 안 늘어나는 상태를 남기지 않는다).
//   ⑤ 같은 회사의 결제가 겹치지 않게 Company.payClaimUntil로 선점한다(SQLite에는 행 잠금이 없다 — 1단계 검수 M8).
//   ⑥ 상태 변경은 lib/pg-state.ts의 moveOrder로만(허용된 이동·빈 글자 금지·열쇠 비우기).
//
// 사장님 결정(2026-11-23): 1개월 단위 · 지금은 카드만 · 미납 유예 3일(차단은 5단계).
// ⚠️ 서버 전용. now·설정을 외부 입력으로 받는 라우트를 만들지 말 것.
import { randomBytes } from "crypto";
import * as kispg from "@newgaon/kispg";
import type { KispgConfig as KisMerchant, ApproveResult } from "@newgaon/kispg";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readKispgConfig } from "@/lib/kispg-config";
import { countHeads, billableCount } from "@/lib/pricing-server";
import { quoteFor, KIS_MAX_TOTAL } from "@/lib/pricing";
import { trialStatus } from "@/lib/trial";
import { moveOrder, kisText } from "@/lib/pg-state";

/** 우리 주문번호 형식 — "HR-" + 한국 시각 14자리 + 난수 6자리(16진수). 결과 받기에서 이 모양이 아니면 아예 찾지 않는다. */
export const ORDER_NO_RE = /^HR-\d{14}-[0-9a-f]{6}$/;
/** 결제 선점 시간. 승인 요청이 30초 안팎이라 넉넉히. 서버가 죽어도 이 시간이 지나면 저절로 풀린다. */
const CLAIM_MS = 3 * 60 * 1000;
/** 미리 결제할 수 있는 한도 — 이용 기간이 이보다 많이 남았으면 결제를 받지 않는다(1개월 단위가 겹겹이 쌓이지 않게). */
export const PREPAY_WINDOW_DAYS = 35;
/** 방금 결제됐으면 다시 받지 않는 시간(같은 달 두 번 결제 방지). */
const RECENT_PAID_MS = 30 * 60 * 1000;
/** 조회가 "결제 없음"이어도 주문 후 이만큼은 실패로 닫지 않는다(KIS 쪽 반영이 늦을 수 있다 — 학원관리와 같은 60분). */
const NOT_FOUND_GRACE_MS = 60 * 60 * 1000;
/** 결제창에서 돌아오지 않은 주문(ready)을 닫는 시간. payReqType=1이라 우리가 승인하지 않으면 돈은 빠지지 않는다. */
const READY_EXPIRE_MS = 60 * 60 * 1000;
/** 같은 주문을 두 곳이 동시에 조회하지 않게 — 마지막 확인 후 이 시간 동안은 건너뛴다(학원관리 120초). */
const CHECK_LOCK_MS = 120 * 1000;
/** 결과 모름 조회 — 처음 20번은 10분마다, 그 뒤로는 1시간마다, 7일이 지나면 운영자 확인 경고. */
const FAST_RETRIES = 20;
const SLOW_INTERVAL_MS = 60 * 60 * 1000;
const GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CreateOrderResult =
  | { ok: true; orderNo: string; action: string; fields: Record<string, string> }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// 날짜·글자 도우미
// ─────────────────────────────────────────────────────────────────────────────

/** 한 달 뒤(달력 기준). 1월 31일 + 1개월 = 2월 28(29)일 — 다음 달에 그 날이 없으면 마지막 날로. 서버 TZ=Asia/Seoul. */
export function addOneMonth(d: Date): Date {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + 1);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

/**
 * 새 결제가 시작되는 시각 = max(지금, 무료 체험 끝, 지금까지 낸 이용 기간 끝).
 *  · 체험 중에 결제해도 남은 체험 일수를 잃지 않는다(체험이 끝난 뒤부터 1개월).
 *  · 이용 기간이 남아 있으면 그 끝에 이어 붙인다(학원관리 applyPaid와 같은 규칙).
 */
export function periodBase(c: { createdAt: Date; trialLastDate: Date | null; paidUntil: Date | null }, now: Date): Date {
  const trialEnd = trialStatus(c.createdAt, now, c.trialLastDate).endsAt;
  // 지금 시작하는 경우는 **오늘 0시**부터 센다 — 시각이 섞이면 "○일까지" 표시가 하루 짧아지고(고객 손해로 보임),
  // 체험 끝·이용 기간 끝은 언제나 자정이라 0시로 맞춰야 이어 붙인 기간도 계속 자정에 끝난다. 오늘 몇 시간은 고객에게 유리한 쪽.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let base = today.getTime();
  if (trialEnd.getTime() > base) base = trialEnd.getTime();
  if (c.paidUntil && c.paidUntil.getTime() > base) base = c.paidUntil.getTime();
  return new Date(base);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
/** "HR-20261123103045-1a2b3c" — 한국 시각(서버 TZ). */
function makeOrderNo(now: Date): string {
  const t = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `HR-${t}-${randomBytes(3).toString("hex")}`;
}
/** 바이트 한도에 맞게 자른다(글자 중간에서 안 자름) — KIS 구매자명 30바이트. */
function fitBytes(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (Buffer.byteLength(out + ch, "utf8") > max) break;
    out += ch;
  }
  return out;
}
/** 결제창에 넣을 전화번호(숫자만, 0으로 시작 9~11자리). 없으면 null. */
function phoneDigits(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/[^0-9]/g, "");
  return /^0\d{8,10}$/.test(d) ? d : null;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 결제 선점(같은 회사 결제 겹침 방지)
// ─────────────────────────────────────────────────────────────────────────────

/** 이 회사의 결제를 선점한다. 성공하면 선점 시각(풀 때 열쇠)을, 다른 결제가 진행 중이면 null. */
async function claimCompany(companyId: string, now: Date): Promise<Date | null> {
  const until = new Date(now.getTime() + CLAIM_MS);
  const r = await prisma.company.updateMany({
    where: { id: companyId, OR: [{ payClaimUntil: null }, { payClaimUntil: { lt: now } }] },
    data: { payClaimUntil: until },
  });
  return r.count === 1 ? until : null;
}
/** 내가 잡은 선점만 푼다(그사이 시간이 지나 다른 결제가 잡았으면 건드리지 않는다). */
async function releaseCompany(companyId: string, token: Date): Promise<void> {
  try {
    await prisma.company.updateMany({ where: { id: companyId, payClaimUntil: token }, data: { payClaimUntil: null } });
  } catch (e) {
    console.warn("[billing-pay] 결제 선점 풀기 실패(시간이 지나면 저절로 풀림):", e instanceof Error ? e.message : String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면용 조회
// ─────────────────────────────────────────────────────────────────────────────

export type PayOverview = {
  ready: boolean;          // 카드 결제를 받을 수 있는가(KIS 설정)
  trialEnd: Date;          // 무료 체험 끝(이 시각 전까지 무료)
  paidUntil: Date | null;  // 낸 이용 기간 끝
  usableUntil: Date;       // 지금 쓸 수 있는 끝 = max(체험 끝, 이용 기간 끝)
  canPayFrom: Date;        // 이 시각부터 결제할 수 있다(이용 기간이 35일 이내로 남았을 때)
};

export async function payOverview(companyId: string, now: Date = new Date()): Promise<PayOverview | null> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { createdAt: true, trialLastDate: true, paidUntil: true } });
  if (!c) return null;
  const trialEnd = trialStatus(c.createdAt, now, c.trialLastDate).endsAt;
  const usableUntil = c.paidUntil && c.paidUntil > trialEnd ? c.paidUntil : trialEnd;
  return {
    ready: !!readKispgConfig().normal,
    trialEnd,
    paidUntil: c.paidUntil,
    usableUntil,
    canPayFrom: new Date(usableUntil.getTime() - PREPAY_WINDOW_DAYS * DAY_MS),
  };
}

/** 결제 내역(최근 12건) — 결제창에서 돌아오지 않은 ready·실패는 빼고, 결제·확인 중·취소만. 카드번호는 가린 값만. */
export async function listPayments(companyId: string) {
  return prisma.pgOrder.findMany({
    where: { companyId, status: { in: ["paid", "check", "cancel_check", "cancelled"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      orderNo: true, productName: true, totalAmount: true, status: true, paidAt: true, cancelledAt: true,
      periodStart: true, periodEnd: true, cardName: true, cardNoMasked: true, createdAt: true,
    },
  });
}

/** 결과 화면 — 자기 회사 주문만. */
export async function orderForCompany(companyId: string, orderNo: string) {
  if (!ORDER_NO_RE.test(orderNo)) return null;
  return prisma.pgOrder.findFirst({
    where: { orderNo, companyId },
    select: {
      orderNo: true, productName: true, totalAmount: true, status: true, failReason: true, pgResultMsg: true,
      paidAt: true, periodStart: true, periodEnd: true, cardName: true, cardNoMasked: true, createdAt: true,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 주문서 만들기 — 결제창을 띄우기 전에 서버가 먼저 만든다
// ─────────────────────────────────────────────────────────────────────────────

export async function createPayOrder(input: { companyId: string; userId: string }, now: Date = new Date()): Promise<CreateOrderResult> {
  const cfg = readKispgConfig();
  if (!cfg.normal || !cfg.returnUrl) return { ok: false, error: "카드 결제를 준비 중입니다. 잠시만 기다려 주세요." };

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      name: true, bizRegNo: true, companyPhone: true, managerPhone: true,
      createdAt: true, trialLastDate: true, paidUntil: true, terminatedAt: true,
    },
  });
  if (!company || company.terminatedAt) return { ok: false, error: "결제할 수 없는 회사입니다." };

  // 확인 중인 결제가 있으면 새로 받지 않는다 — 돈이 빠졌는지 모르는 결제 위에 또 결제하면 두 번 낼 수 있다.
  const pending = await prisma.pgOrder.count({ where: { companyId: input.companyId, status: { in: ["check", "cancel_check"] } } });
  if (pending > 0) return { ok: false, error: "확인 중인 결제가 있습니다. 10분쯤 뒤 결제 내역을 확인한 다음 다시 시도해 주세요." };
  const recentPaid = await prisma.pgOrder.count({
    where: { companyId: input.companyId, status: "paid", paidAt: { gt: new Date(now.getTime() - RECENT_PAID_MS) } },
  });
  if (recentPaid > 0) return { ok: false, error: "방금 결제가 끝났습니다. 결제 내역을 확인해 주세요." };

  const base = periodBase(company, now);
  if (base.getTime() - now.getTime() > PREPAY_WINDOW_DAYS * DAY_MS) {
    return { ok: false, error: `${ymd(base)}까지 이용할 수 있습니다. 남은 기간이 ${PREPAY_WINDOW_DAYS}일 이내가 되면 결제할 수 있습니다.` };
  }

  const heads = await countHeads(input.companyId);
  const q = quoteFor(billableCount(heads.employees, heads.admins));
  if (q.kind === "none") return { ok: false, error: "요금 대상 인원이 없어 결제할 금액이 없습니다." };
  if (q.kind === "quote") return { ok: false, error: "요금표를 넘는 인원이라 별도 협의가 필요합니다. 고객센터로 연락해 주세요." };
  const max = cfg.maxAmount ?? KIS_MAX_TOTAL;
  if (q.total > max) return { ok: false, error: "카드 1회 결제 한도를 넘는 금액입니다. 고객센터로 연락해 주세요." };

  const tel = phoneDigits(company.managerPhone) ?? phoneDigits(company.companyPhone);
  if (!tel) return { ok: false, error: "카드 결제창에 넣을 연락처가 없습니다. [회사정보]에서 담당자 연락처를 입력해 주세요." };

  const orderNo = makeOrderNo(now);
  const productName = `가온 근태관리 1개월 (${q.label})`;
  let built: { action: string; fields: Record<string, string> };
  try {
    built = kispg.buildAuthRequest({
      config: cfg.normal,
      order: {
        ordNo: orderNo, goodsNm: productName, goodsAmt: q.total,
        ordNm: fitBytes(company.name.trim() || "가온 근태관리 고객", 30), ordTel: tel,
        returnUrl: cfg.returnUrl, payMethod: "CARD",
      },
      now,
    });
  } catch (e) {
    console.error("[billing-pay] 결제창 값 만들기 실패:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "결제창을 열 수 없습니다. 고객센터로 문의해 주세요." };
  }

  await prisma.pgOrder.create({
    data: {
      companyId: input.companyId, userId: input.userId, orderNo, orderType: "normal", pgMid: cfg.normal.mid,
      productName, employees: q.employees, headEmployees: heads.employees, headAdmins: heads.admins,
      tierIndex: q.tierIndex, termMonths: 1, payMethod: "CARD",
      supplyAmount: q.monthly, vatAmount: q.vat, totalAmount: q.total, status: "ready",
      buyerName: company.name, buyerBizRegNo: company.bizRegNo,
    },
  });
  return { ok: true, orderNo, action: built.action, fields: built.fields };
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 결제창 결과 받기(returnUrl) → 승인
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 결제창이 건넨 결과를 처리한다. 무엇이 와도 예외를 던지지 않는다.
 * @returns 결과 화면에 보낼 주문번호(모르면 null)
 */
export async function handlePayReturn(body: Record<string, unknown>, now: Date = new Date()): Promise<string | null> {
  const auth = kispg.parseAuthResult(body);
  if (!ORDER_NO_RE.test(auth.ordNo)) return null;
  const order = await prisma.pgOrder.findUnique({ where: { orderNo: auth.ordNo } });
  if (!order) return null;
  if (order.orderType !== "normal" || order.status !== "ready") return order.orderNo; // 이미 처리됨 — 결과만 보여 준다

  const cfg = readKispgConfig().normal;
  const fail = async (reason: string) => {
    await moveOrder(prisma, order.id, ["ready"], "failed", {
      failReason: reason, pgResultCode: kisText(auth.resultCd, 20), pgResultMsg: kisText(auth.resultMsg),
    });
  };
  if (!cfg || cfg.mid !== order.pgMid) {
    await fail("결제 설정이 바뀌어 승인하지 않았습니다.");
    return order.orderNo;
  }
  if (!auth.ok) {
    await fail(auth.resultMsg || "카드 인증이 끝나지 않았습니다.");
    return order.orderNo;
  }
  if (Number(auth.amt) !== order.totalAmount) {
    await fail("인증 금액이 주문 금액과 달라 승인하지 않았습니다.");
    return order.orderNo;
  }
  // 암호값 검사는 KIS 실제 시험으로 식을 확정하기 전까지 **기록만** 한다(학원관리 4단계와 같은 상태).
  if (!kispg.verifyAuthResult({ config: cfg, result: auth })) {
    console.warn(`[billing-pay] 인증 결과 암호값 불일치(기록만) — 주문 ${order.orderNo}`);
  }

  const token = await claimCompany(order.companyId, now);
  if (!token) {
    await fail("같은 회사의 다른 결제가 진행 중이라 승인하지 않았습니다.");
    return order.orderNo;
  }
  try {
    try {
      const moved = await moveOrder(prisma, order.id, ["ready"], "check", { pgTid: auth.tid, lastCheckedAt: now });
      if (!moved) return order.orderNo; // 다른 요청이 먼저 가져감
    } catch (e) {
      // 같은 거래번호가 이미 다른 주문에 쓰였다(재전송·조작) — 승인하지 않는다.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        await fail("이미 쓰인 거래번호라 승인하지 않았습니다.");
        return order.orderNo;
      }
      throw e;
    }
    const paid = await kispg.approve({ config: cfg, tid: auth.tid, goodsAmt: order.totalAmount, ordNo: order.orderNo });
    await settleApprove(order.id, cfg, paid);
  } catch (e) {
    // 여기까지 새는 예외는 DB 장애 등 — 주문은 check로 남아 10분 정리가 조회로 닫는다(돈이 빠졌는지 모르므로 실패로 단정 금지).
    console.error(`[billing-pay] 결제 결과 처리 오류 — 주문 ${order.orderNo}:`, e instanceof Error ? e.message : String(e));
  } finally {
    await releaseCompany(order.companyId, token);
  }
  return order.orderNo;
}

/** 승인 응답을 정리한다(돌아온 직후·10분 정리 공통). 주문은 check 상태여야 한다. */
async function settleApprove(orderId: string, cfg: KisMerchant, paid: ApproveResult): Promise<void> {
  const order = await prisma.pgOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "check") return;

  if (paid.ok) {
    await applyOrCancel(orderId, cfg, {
      amt: paid.amt ?? order.totalAmount, appNo: paid.appNo, payMethod: paid.payMethod,
      cardNo: paid.cardNo, cardType: paid.cardType, cardName: paid.fnNm, code: paid.resultCd, msg: paid.resultMsg,
    });
    return;
  }
  if (paid.amountMismatch) {
    await cancelCheck(orderId, cfg, paid.amt ?? null, "승인 금액이 주문 금액과 달라 자동 취소");
    return;
  }
  if (paid.uncertain) {
    await prisma.pgOrder.updateMany({
      where: { id: orderId, status: "check" },
      data: { failReason: kisText(`결과 모름 — ${paid.error ?? ""}`), pgResultCode: kisText(paid.resultCd, 20) },
    });
    return; // 10분 정리가 조회로 닫는다
  }
  // 확정 거절 응답이어도 한 번 더 조회해서 "결제 없음"일 때만 실패로 닫는다(학원관리와 같다).
  const r = await kispg.inquire({ config: cfg, tid: order.pgTid ?? undefined, ordNo: order.orderNo, goodsAmt: order.totalAmount });
  if (r.status === "not_found") {
    await moveOrder(prisma, orderId, ["check"], "failed", {
      failReason: kisText(paid.error ?? "승인되지 않았습니다."), pgResultCode: kisText(paid.resultCd, 20), pgResultMsg: kisText(paid.resultMsg),
    });
  } else if (r.status === "approved" && !r.amountMismatch && !r.uncertain) {
    await applyOrCancel(orderId, cfg, { amt: r.amt ?? order.totalAmount, appNo: r.appNo, payMethod: r.payMethod, code: r.resultCd, msg: r.resultMsg });
  } else if (r.status === "approved" && r.amountMismatch) {
    await cancelCheck(orderId, cfg, r.amt, "승인 금액이 주문 금액과 달라 자동 취소");
  }
  // 그 밖(unknown 등)은 check로 둔다.
}

type PaidInfo = {
  amt: number; appNo?: string; payMethod?: string; cardNo?: string; cardType?: string; cardName?: string; code?: string; msg?: string;
};

/**
 * 승인된 결제를 반영한다(주문 paid + 회사 이용 기간 1개월 연장, 한 묶음). 반영이 실패하면 즉시 취소한다.
 *  ⚠️ 실패했을 때 바로 취소하지 않고 주문을 **다시 읽는다** — 다른 요청이 이미 paid로 반영했다면 정상 결제를 환불하는 사고가 된다.
 */
async function applyOrCancel(orderId: string, cfg: KisMerchant, info: PaidInfo): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const o = await tx.pgOrder.findUnique({ where: { id: orderId } });
      if (!o || o.status !== "check") throw new Error("반영할 수 있는 상태가 아님");
      const c = await tx.company.findUnique({
        where: { id: o.companyId },
        select: { createdAt: true, trialLastDate: true, paidUntil: true, terminatedAt: true },
      });
      if (!c) throw new Error("회사가 없음(해지 파기됨)");
      if (c.terminatedAt) throw new Error("해지된 회사");
      const now = new Date();
      const start = periodBase(c, now);
      const end = addOneMonth(start);
      const ok = await moveOrder(tx, o.id, ["check"], "paid", {
        paidAt: now, pgAmount: info.amt, pgAppNo: kisText(info.appNo, 40), pgPayMethod: kisText(info.payMethod, 20),
        cardName: kisText(info.cardName, 40), cardNoMasked: kisText(info.cardNo, 40), cardType: kisText(info.cardType, 20),
        pgResultCode: kisText(info.code, 20), pgResultMsg: kisText(info.msg),
        prevPaidUntil: c.paidUntil, periodStart: start, periodEnd: end, failReason: null,
      });
      if (!ok) throw new Error("다른 요청이 먼저 처리");
      await tx.company.update({ where: { id: o.companyId }, data: { paidUntil: end } });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const now = await prisma.pgOrder.findUnique({ where: { id: orderId }, select: { status: true, orderNo: true } });
    if (!now || now.status !== "check") return; // 이미 반영(또는 정리)됨 — 취소하면 안 된다
    console.error(`[billing-pay] 이용 기간 반영 실패 → 자동 취소 — 주문 ${now.orderNo}: ${msg}`);
    await cancelCheck(orderId, cfg, info.amt, `이용 기간 반영 실패로 자동 취소(${msg})`);
  }
}

/**
 * check 주문을 취소한다(cancel_check로 옮긴 뒤 KIS 취소). 결과가 애매하면 cancel_check로 두고 10분 정리가 다시 한다.
 * @param amt 취소할 금액(실제 승인 금액). null이면 조회로 알아낸 뒤 취소 — 그것도 모르면 정리 작업에 맡긴다.
 */
async function cancelCheck(orderId: string, cfg: KisMerchant, amt: number | null, reason: string): Promise<void> {
  const moved = await moveOrder(prisma, orderId, ["check"], "cancel_check", {
    failReason: kisText(reason), ...(amt !== null ? { pgAmount: amt } : {}),
  });
  if (!moved) return;
  await runCancel(orderId, cfg);
}

/** cancel_check 주문을 KIS에 취소 요청한다. 성공·이미 취소됨이면 cancelled. */
async function runCancel(orderId: string, cfg: KisMerchant): Promise<void> {
  const o = await prisma.pgOrder.findUnique({ where: { id: orderId } });
  if (!o || o.status !== "cancel_check" || !o.pgTid) return;
  let canAmt = o.pgAmount;
  if (canAmt === null) {
    const r = await kispg.inquire({ config: cfg, tid: o.pgTid, ordNo: o.orderNo, goodsAmt: o.totalAmount });
    if (r.status === "cancelled") {
      await moveOrder(prisma, o.id, ["cancel_check"], "cancelled", { cancelledAt: new Date() });
      return;
    }
    if (r.status === "not_found") {
      // 취소하려던 결제가 KIS에 없다 — 돈이 빠지지 않은 것. 취소 완료로 닫는다.
      await moveOrder(prisma, o.id, ["cancel_check"], "cancelled", { cancelledAt: new Date(), failReason: kisText(`${o.failReason ?? ""} / 조회 결과 결제 없음`) });
      return;
    }
    if (r.amt === null) return; // 금액을 모르면 다음 정리 때
    canAmt = r.amt;
    await prisma.pgOrder.update({ where: { id: o.id }, data: { pgAmount: canAmt } });
  }
  const c = await kispg.cancel({ config: cfg, tid: o.pgTid, payMethod: "CARD", canAmt, canMsg: o.failReason ?? "자동 취소", ordNo: o.orderNo });
  if (c.ok || c.alreadyCancelled) {
    await moveOrder(prisma, o.id, ["cancel_check"], "cancelled", { cancelledAt: new Date() });
  } else {
    console.warn(`[billing-pay] 자동 취소가 끝나지 않음(정리 작업이 다시 시도) — 주문 ${o.orderNo}: ${c.error ?? ""}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 10분 정리 — 결과 모름(check)·취소 중(cancel_check)·결제창에서 안 돌아온 주문(ready)
// ─────────────────────────────────────────────────────────────────────────────

let reconciling = false;

export async function reconcilePayOrders(limit = 20, now: Date = new Date()): Promise<{ expired: number; checked: number }> {
  if (reconciling) return { expired: 0, checked: 0 };
  reconciling = true;
  try {
    // (가) 결제창에서 돌아오지 않은 주문 — 우리가 승인하지 않았으므로 돈은 빠지지 않았다. 1시간 뒤 닫는다.
    const stale = await prisma.pgOrder.findMany({
      where: { orderType: "normal", status: "ready", createdAt: { lt: new Date(now.getTime() - READY_EXPIRE_MS) } },
      select: { id: true }, take: 100,
    });
    let expired = 0;
    for (const s of stale) {
      if (await moveOrder(prisma, s.id, ["ready"], "failed", { failReason: "결제창에서 돌아오지 않아 닫음(돈이 빠지지 않음)" })) expired++;
    }

    const cfg = readKispgConfig().normal;
    if (!cfg) return { expired, checked: 0 };

    // (나) 결과 모름·취소 중 — KIS 조회·취소로 닫는다.
    const lockBefore = new Date(now.getTime() - CHECK_LOCK_MS);
    const pending = await prisma.pgOrder.findMany({
      where: {
        status: { in: ["check", "cancel_check"] },
        orderType: "normal",
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: lockBefore } }],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    let checked = 0;
    for (const o of pending) {
      const age = now.getTime() - o.createdAt.getTime();
      if (o.retryCount >= FAST_RETRIES && o.lastCheckedAt && now.getTime() - o.lastCheckedAt.getTime() < SLOW_INTERVAL_MS) continue;
      if (o.pgMid !== cfg.mid) {
        console.error(`[billing-pay] [운영자 확인 필요] 주문 ${o.orderNo}의 상점ID가 지금 설정과 달라 조회하지 못함`);
        continue;
      }
      // 조회 잠금 — 읽은 lastCheckedAt 그대로일 때만(두 서버·두 회차가 같은 주문을 동시에 만지지 않게)
      const locked = await prisma.pgOrder.updateMany({
        where: { id: o.id, status: o.status, lastCheckedAt: o.lastCheckedAt },
        data: { lastCheckedAt: now, retryCount: { increment: 1 } },
      });
      if (locked.count !== 1) continue;
      checked++;
      if (o.retryCount + 1 >= FAST_RETRIES || age > 6 * DAY_MS) {
        console.error(`[billing-pay] [운영자 확인 필요] 주문 ${o.orderNo} ${o.status} — ${o.retryCount + 1}번째 확인`);
      }
      if (age > GIVE_UP_MS) continue; // 7일이 지나면 자동으로 닫지 않는다(운영자 화면 6단계에서 사람이 판단)
      try {
        if (o.status === "cancel_check") {
          await runCancel(o.id, cfg);
          continue;
        }
        if (!o.pgTid) continue;
        const r = await kispg.inquire({ config: cfg, tid: o.pgTid, ordNo: o.orderNo, goodsAmt: o.totalAmount });
        if (r.status === "approved" && !r.uncertain && !r.amountMismatch) {
          const token = await claimCompany(o.companyId, now);
          // 회사 행이 없으면(파기) 선점이 안 된다 → applyOrCancel이 "회사 없음"으로 취소한다. 선점이 다른 결제에 잡혀 있으면 다음 회차에.
          const companyExists = (await prisma.company.count({ where: { id: o.companyId } })) > 0;
          if (!token && companyExists) continue;
          try {
            await applyOrCancel(o.id, cfg, { amt: r.amt ?? o.totalAmount, appNo: r.appNo, payMethod: r.payMethod, code: r.resultCd, msg: r.resultMsg });
          } finally {
            if (token) await releaseCompany(o.companyId, token);
          }
        } else if (r.status === "approved" && r.amountMismatch) {
          await cancelCheck(o.id, cfg, r.amt, "승인 금액이 주문 금액과 달라 자동 취소");
        } else if (r.status === "cancelled") {
          await moveOrder(prisma, o.id, ["check"], "cancelled", { cancelledAt: now, failReason: kisText("KIS 조회 결과 취소된 결제") });
        } else if (r.status === "not_found" && age > NOT_FOUND_GRACE_MS) {
          await moveOrder(prisma, o.id, ["check"], "failed", { failReason: kisText(`KIS 조회 결과 결제 없음 — ${o.failReason ?? ""}`) });
        }
      } catch (e) {
        console.error(`[billing-pay] 정리 중 오류 — 주문 ${o.orderNo}:`, e instanceof Error ? e.message : String(e));
      }
    }
    return { expired, checked };
  } finally {
    reconciling = false;
  }
}
