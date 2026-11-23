// [구독 자동결제] 카드 등록 → 매달 자동 청구 → 실패 재시도·멈춤 → 해지(카드 지우기)
//   2026-11-23 결제 3단계(사장님 "추천대로 진행해줘"). 계획서 plan-근태결제-개발.md "3단계 자동결제 계획".
//
// 원본 규칙: 학원관리 subscriptionBillingService.js(등록·해지)·subscriptionAutoChargeService.js(매달 청구).
//  그 코드는 MySQL 행 잠금·LMS- 번호·학원 표에 묶여 있어 그대로 쓰지 않고 원칙만 옮겼다:
//   ① 금액·회사는 **DB(카드 행·주문서)에서** 꺼낸다. 등록 창에서 돌아온 값(ordNo·amt)은 찾는 열쇠·대조용으로만.
//   ② 상태 바꾸기는 lib/pg-state.ts의 moveKey·moveOrder로만, 언제나 "지금 상태가 X일 때만"(같은 결과가 두 번 와도 한 번만).
//   ③ 🔴 빌키(bid)는 화면·로그·응답에 내보내지 않는다. DB에는 **암호화해서**(lib/sms-crypto — SMS_CRED_KEY) 넣는다
//      (백업이 서버 15일·외부 30일 남기 때문 — 1단계 검수 경미 7). 카드번호는 KIS가 가린 값만.
//   ④ 빌키를 받았는데 쓰지 않게 되면 failed가 아니라 **deleting → KIS에서 지운다**(KIS에 빌키가 남지 않게).
//   ⑤ 결과를 모르면 실패로 단정하지 않는다 — reg_check·check로 두고 10분 정리가 조회로 닫는다.
//
// 🔴 회사 해지(운영자 화면)·자동결제 해지(관리자)는 markCompanyCardsForDeletion·cancelAutoPay를 거친다.
//    나중에 "관리자가 직접 회사 삭제" 버튼을 만들면 그 버튼도 반드시 markCompanyCardsForDeletion을 부를 것(11-23 사장님 질문).
// ⚠️ 서버 전용. now·설정을 외부 입력으로 받는 라우트를 만들지 말 것.
import { randomBytes } from "crypto";
import * as kispg from "@newgaon/kispg";
import type { KispgConfig as KisMerchant, IssueBillingKeyResult } from "@newgaon/kispg";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readKispgConfig } from "@/lib/kispg-config";
import { hasSmsCryptoKey, encryptSmsPassword, decryptSmsPassword } from "@/lib/sms-crypto";
import { countHeads, billableCount } from "@/lib/pricing-server";
import { quoteFor, KIS_MAX_TOTAL, PRICE_TIERS, tierLabel, withVat, type Quote } from "@/lib/pricing";
import { periodBase, phoneDigits, fitBytes, makeOrderNo, applyPaidOrder, claimCompany, releaseCompany } from "@/lib/billing-pay";
import { moveKey, moveOrder, kisText } from "@/lib/pg-state";
import { toISODate } from "@/lib/period";
import type { BillingPayResult } from "@newgaon/kispg";

/** 카드 등록 번호 — "HRB-" + 한국 시각 14자리 + 난수 6자리. 결과 받기에서 이 모양이 아니면 카드 등록으로 보지 않는다. */
export const REG_NO_RE = /^HRB-\d{14}-[0-9a-f]{6}$/;
/** 이용 기간이 끝나기 며칠 전에 청구하나(학원관리 사장님 결정 ⑦-1과 같음 — 실패해도 이틀 더 시도할 여유). */
export const CHARGE_DAYS_BEFORE = 3;
/** 등록 창만 열고 돌아오지 않은 등록은 하루 뒤 실패로 닫는다(빌키가 없으니 돈·KIS 정리는 필요 없다). */
const ABANDONED_REG_MS = 24 * 60 * 60 * 1000;
/** 등록 결과 모름(reg_check)은 이 시간이 지나야 KIS 조회 "결제 없음"을 믿고 실패로 닫는다(일반 결제와 같은 60분). */
const REG_CHECK_GRACE_MS = 60 * 60 * 1000;
/** 등록 결과 모름이 이만큼 지나도 확인이 안 되면 닫는다(그 회사의 새 등록·파기가 영원히 막히지 않게 — 3단계 검수 중간 4). */
const REG_CHECK_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
/** KIS 지우기 재시도 간격·운영자 경고 기준. */
const DELETE_RETRY_MS = 10 * 60 * 1000;
const DELETE_WARN_TRIES = 20;
/** 뒤에서 지울 때 KIS 응답을 넉넉히 기다린다(학원관리 실시험: 시험 서버 지우기에 30초 가까이 걸림). */
const BACKGROUND_DELETE_TIMEOUT_MS = 90 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// 설정·도우미
// ─────────────────────────────────────────────────────────────────────────────

/** 자동결제를 받을 수 있는 설정인가 — 빌링 상점 + 결과 받는 주소 + 빌키 암호화 열쇠. 하나라도 없으면 "준비 중". */
function billingMerchant(): KisMerchant | null {
  const c = readKispgConfig();
  if (!c.billing || !c.returnUrl) return null;
  if (!hasSmsCryptoKey()) return null; // 빌키를 평문으로 저장하지 않는다(머리말 ③)
  return c.billing;
}
export function autoPayReady(): boolean {
  return billingMerchant() !== null;
}
/** 이 카드를 등록한 상점의 설정 — 지금 설정과 상점ID가 다르면 null(다른 상점으로 결제·삭제하지 않는다). */
function configForMid(pgMid: string): KisMerchant | null {
  const m = billingMerchant();
  return m && m.mid === pgMid ? m : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function makeRegNo(now: Date): string {
  const t = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `HRB-${t}-${randomBytes(3).toString("hex")}`;
}
function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
/** 내일 0시(한국 시각 — 서버 TZ). "같은 날 두 번 시도하지 않는다"의 다음 결제일. */
export function tomorrowStart(now: Date): Date {
  const r = startOfDay(now);
  r.setDate(r.getDate() + 1);
  return r;
}

/**
 * 다음 결제일(그날 0시) = 새 이용 기간이 시작되는 날(periodBase) 3일 전. 이미 지났으면 오늘.
 *  · 결제는 그날 **오전 10시 이후** 정기 작업이 한다(3-2).
 */
export function nextChargeDateFor(base: Date, now: Date): Date {
  const d = startOfDay(base);
  d.setDate(d.getDate() - CHARGE_DAYS_BEFORE);
  const today = startOfDay(now);
  return d.getTime() < today.getTime() ? today : d;
}

/** 자동결제 청구 금액 — kind를 좁혀야 금액을 꺼낼 수 있다(lib/pricing.ts Quote와 같은 이유: 0명·미동의 청구를 타입이 막는다). */
export type AutoChargeAmount =
  | { kind: "charge"; tierIndex: number; label: string; monthly: number; vat: number; total: number; capped: boolean }
  | { kind: "none" }
  | { kind: "quote" }
  | { kind: "no_consent" };

/**
 * 자동결제로 청구할 금액 = min(지금 인원 구간, 동의한 구간)(1단계 검수 M7).
 *  · 동의한 구간이 없으면 청구하지 않는다(null) — 동의 없이 돈을 빼지 않는다.
 *  · 인원이 줄면 낮은 구간(고객에게 유리 — 동의 불필요), 늘면 동의한 구간에서 멈춘다.
 */
export function autoChargeAmount(
  q: Quote,
  approvedTierIndex: number | null
): AutoChargeAmount {
  if (q.kind !== "tier") return { kind: q.kind };
  if (approvedTierIndex === null || !Number.isInteger(approvedTierIndex) || approvedTierIndex < 0 || approvedTierIndex >= PRICE_TIERS.length) {
    return { kind: "no_consent" };
  }
  const idx = Math.min(q.tierIndex, approvedTierIndex);
  const label = tierLabel(idx);
  if (label === null) return { kind: "no_consent" }; // 도달 불가(방어)
  const money = withVat(PRICE_TIERS[idx].monthly);
  return { kind: "charge", tierIndex: idx, label, monthly: money.supply, vat: money.vat, total: money.total, capped: idx < q.tierIndex };
}

/** Prisma 오류에서 **코드만** 꺼낸다 — 유일 조건 위반 문구에 칸 값(빌키)이 들어갈 수 있어 원문을 찍지 않는다(학원관리 3단계 검수 중간 5). */
function errCode(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
  return e instanceof Error ? e.name : "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면용 조회 — 🔴 빌키·상점ID·거래번호는 넣지 않는다
// ─────────────────────────────────────────────────────────────────────────────

export type AutoPayCard = {
  status: string;
  cardName: string | null;
  cardNoMasked: string | null;
  nextChargeDate: Date | null;
  failCount: number;
  lastFailReason: string | null;
  registeredAt: Date | null;
  pausedAt: Date | null;
};

export type AutoPayOverview = {
  ready: boolean;
  /** 사용 중·멈춤 카드(없으면 null) */
  card: AutoPayCard | null;
  /** 등록 결과 확인 중(reg_check) 카드가 있다 — 새 등록을 받지 않는다 */
  regChecking: boolean;
  /** 지우는 중인 카드가 있다(해지 직후) */
  deleting: boolean;
  /** 지금 신청하면: 새 이용 기간 시작일·첫 결제일 */
  periodStart: Date;
  firstChargeDate: Date;
  approvedTierIndex: number | null;
};

export async function autoPayOverview(companyId: string, now: Date = new Date()): Promise<AutoPayOverview | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { createdAt: true, trialLastDate: true, paidUntil: true, approvedTierIndex: true },
  });
  if (!c) return null;
  const keys = await prisma.pgBillingKey.findMany({
    where: { companyId, status: { in: ["active", "paused", "reg_check", "deleting"] } },
    orderBy: { createdAt: "desc" },
    select: {
      status: true, cardName: true, cardNoMasked: true, nextChargeDate: true, failCount: true, lastFailReason: true,
      registeredAt: true, pausedAt: true,
    },
  });
  const live = keys.find((k) => k.status === "active" || k.status === "paused") ?? null;
  const base = periodBase(c, now);
  return {
    ready: autoPayReady(),
    card: live,
    regChecking: keys.some((k) => k.status === "reg_check"),
    deleting: keys.some((k) => k.status === "deleting"),
    periodStart: base,
    firstChargeDate: nextChargeDateFor(base, now),
    approvedTierIndex: c.approvedTierIndex,
  };
}

/** 등록 결과 화면 — 자기 회사 카드만. */
export async function cardForCompany(companyId: string, regNo: string) {
  if (!REG_NO_RE.test(regNo)) return null;
  const k = await prisma.pgBillingKey.findFirst({
    where: { regNo, companyId },
    select: { id: true, regNo: true, status: true, cardName: true, cardNoMasked: true, nextChargeDate: true, lastFailReason: true, consentTotal: true },
  });
  if (!k) return null;
  // 등록 직후 바로 한 첫 결제(결제일이 이미 지난 경우) — 결과 화면에 함께 보인다. 없으면 null.
  const firstCharge = await prisma.pgOrder.findFirst({
    where: { companyId, billingKeyId: k.id, orderType: "billing_auto" },
    orderBy: { createdAt: "asc" },
    select: { status: true, totalAmount: true, periodStart: true, periodEnd: true, pgResultMsg: true },
  });
  const { id: _id, ...view } = k;
  void _id;
  return { ...view, firstCharge };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 카드 등록 시작 — 동의 확인 → 카드 행(registering) → KIS 카드 등록 창 값
// ─────────────────────────────────────────────────────────────────────────────

export type StartRegResult =
  | { ok: true; regNo: string; action: string; fields: Record<string, string> }
  | { ok: false; error: string };

export async function startCardRegistration(
  input: { companyId: string; userId: string; consent: boolean; seenTierIndex: number },
  now: Date = new Date()
): Promise<StartRegResult> {
  const cfg = billingMerchant();
  const returnUrl = readKispgConfig().returnUrl;
  if (!cfg || !returnUrl) return { ok: false, error: "자동결제를 준비 중입니다. 잠시만 기다려 주세요." };
  // 동의는 따로 체크(일괄 동의 금지 — 2025-02 시행 개정 전자상거래법 제13조 ⑥ 취지). 화면이 체크 없이 보내도 서버가 막는다.
  if (!input.consent) return { ok: false, error: "자동결제 안내를 확인하고 동의에 체크해 주세요." };

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { name: true, companyPhone: true, managerPhone: true, terminatedAt: true },
  });
  if (!company || company.terminatedAt) return { ok: false, error: "자동결제를 신청할 수 없는 회사입니다." };

  // 등록 결과를 확인 중인 카드가 있으면 새로 받지 않는다 — KIS에 카드가 두 장 생길 수 있다.
  const checking = await prisma.pgBillingKey.count({ where: { companyId: input.companyId, status: "reg_check" } });
  if (checking > 0) return { ok: false, error: "카드 등록 결과를 확인하고 있습니다. 1시간쯤 뒤 다시 확인해 주세요." };

  const heads = await countHeads(input.companyId);
  const q = quoteFor(billableCount(heads.employees, heads.admins));
  if (q.kind === "none") return { ok: false, error: "요금 대상 인원이 없어 자동결제를 신청할 금액이 없습니다." };
  if (q.kind === "quote") return { ok: false, error: "요금표를 넘는 인원이라 별도 협의가 필요합니다. 고객센터로 연락해 주세요." };
  // 🔴 관리자가 체크한 금액(화면을 띄울 때의 구간)과 지금 서버 계산이 같아야 한다 — 그사이 인원이 늘어 윗구간이 됐으면
  //    보지 않은 금액에 동의시키지 않는다(3단계 검수 중간 1). 새로 고쳐 바뀐 금액을 보고 다시 체크하게 한다.
  if (!Number.isInteger(input.seenTierIndex) || input.seenTierIndex !== q.tierIndex) {
    return { ok: false, error: "그사이 인원이 바뀌어 금액이 달라졌습니다. 화면을 새로 고쳐 금액을 다시 확인해 주세요." };
  }
  const max = readKispgConfig().maxAmount ?? KIS_MAX_TOTAL;
  if (q.total > max) return { ok: false, error: "카드 1회 결제 한도를 넘는 금액입니다. 고객센터로 연락해 주세요." };

  const tel = phoneDigits(company.managerPhone) ?? phoneDigits(company.companyPhone);
  if (!tel) return { ok: false, error: "카드 등록 창에 넣을 연락처가 없습니다. [회사정보]에서 담당자 연락처를 입력해 주세요." };

  const regNo = makeRegNo(now);
  let built: { action: string; fields: Record<string, string> };
  try {
    built = kispg.buildBillingAuthRequest({
      config: cfg,
      order: {
        ordNo: regNo, goodsNm: `가온 근태관리 자동결제 신청 (${q.label})`, goodsAmt: q.total,
        ordNm: fitBytes(company.name.trim() || "가온 근태관리 고객", 30), ordTel: tel, returnUrl, payMethod: "CARD",
      },
      now,
    });
  } catch (e) {
    console.error("[billing-auto] 카드 등록 창 값 만들기 실패:", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "카드 등록 창을 열 수 없습니다. 고객센터로 문의해 주세요." };
  }

  // 앞서 열었다가 그냥 닫은 등록 창(빌키 없음)은 닫는다 — 등록 중 중복은 앱에서 막는다(1단계 검수 M1).
  const stale = await prisma.pgBillingKey.findMany({
    where: { companyId: input.companyId, status: "registering", bid: null },
    select: { id: true },
  });
  for (const s of stale) {
    await moveKey(prisma, s.id, ["registering"], "failed", { lastFailReason: "새 등록 창을 열어 이전 창은 닫음" });
  }

  await prisma.pgBillingKey.create({
    data: {
      companyId: input.companyId, userId: input.userId, regNo, pgMid: cfg.mid, status: "registering",
      consentTierIndex: q.tierIndex, consentTotal: q.total, consentedAt: now,
    },
  });
  return { ok: true, regNo, action: built.action, fields: built.fields };
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 카드 등록 창 결과(returnUrl, HRB-…) → 등록 확정 → 사용 시작
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 카드 등록 창이 건넨 결과를 처리한다. 무엇이 와도 예외를 던지지 않는다(라우트가 결과 화면으로 보낸다).
 * @returns 결과 화면에 보낼 등록 번호(모르면 null)와, 사용을 시작한 카드 id(바로 청구할지 판단용 — 3-2)
 */
export async function handleCardReturn(body: Record<string, unknown>): Promise<{ regNo: string | null; activatedKeyId: string | null }> {
  const auth = kispg.parseAuthResult(body);
  if (!REG_NO_RE.test(auth.ordNo)) return { regNo: null, activatedKeyId: null };
  const key = await prisma.pgBillingKey.findUnique({ where: { regNo: auth.ordNo } });
  if (!key) return { regNo: null, activatedKeyId: null };
  const done = { regNo: key.regNo, activatedKeyId: null };
  if (key.status !== "registering" || key.bid) return done; // 이미 처리됨(새로고침·KIS 재전송) — 결과만 보여 준다

  const fail = async (reason: string) => {
    await moveKey(prisma, key.id, ["registering"], "failed", {
      lastFailReason: kisText(reason), lastResultCode: kisText(auth.resultCd, 20),
    });
  };
  const cfg = configForMid(key.pgMid);
  if (!cfg) {
    await fail("결제 설정이 바뀌어 카드를 등록하지 않았습니다.");
    return done;
  }
  if (!auth.ok) {
    await fail(auth.resultMsg || "카드 등록이 끝나지 않았습니다.");
    return done;
  }
  if (auth.payMethod && auth.payMethod !== "CARD") {
    await fail("카드만 등록할 수 있습니다.");
    return done;
  }
  if (key.consentTotal === null || Number(auth.amt) !== key.consentTotal) {
    await fail("카드 등록 창 금액이 신청 금액과 달라 진행하지 않았습니다.");
    return done;
  }
  // 응답 암호값 검사는 KIS 실제 시험으로 식을 확정하기 전까지 기록만(일반 결제·학원관리와 같음).
  if (!kispg.verifyAuthResult({ config: cfg, result: auth })) {
    console.warn(`[billing-auto] 카드 등록 결과 암호값 불일치(기록만) — ${key.regNo}`);
  }

  // 선점: registering → reg_check(+거래번호). 같은 결과가 동시에 두 번 와도 한 곳만 KIS에 등록 확정을 보낸다.
  try {
    const moved = await moveKey(prisma, key.id, ["registering"], "reg_check", { pgTid: auth.tid, lastCheckedAt: new Date() });
    if (!moved) return done;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await fail("이미 쓰인 카드 등록 정보라 진행하지 않았습니다.");
      return done;
    }
    throw e;
  }

  const issued = await kispg.issueBillingKey({ config: cfg, tid: auth.tid, goodsAmt: key.consentTotal, ordNo: key.regNo });
  console.log(`[billing-auto] 카드 등록 확정 ${key.regNo}: ok=${issued.ok} 코드=${issued.resultCd || "-"} 결과모름=${issued.uncertain} 결제가능성=${issued.mayBeCharged}`);
  if (issued.ok) {
    const activated = await activateIssued(key.id, cfg, issued);
    if (activated) {
      // 결제일이 이미 지났으면(체험 끝남·이용 기간 끝남) **매달 청구와 같은 함수로** 바로 청구한다 — 첫 결제 경로를 따로 두지 않는다
      //  (계획서 설계 결정 1). 결제일이 앞이면 chargeKey가 not_due로 그냥 돌아온다. 관리자가 직접 신청한 순간이라 10시 제한은 없다.
      try {
        await chargeKey(key.id);
      } catch (e) {
        console.error(`[billing-auto] 등록 직후 청구 오류(정기 작업이 다시 봄) — ${key.regNo}: ${errCode(e)}`);
      }
    }
    return { regNo: key.regNo, activatedKeyId: activated ? key.id : null };
  }
  if (issued.uncertain) {
    // 등록이 됐는지(또는 결제가 됐는지) 모른다 → reg_check 그대로, 정리가 조회로 확인한다(실패로 단정 금지).
    await prisma.pgBillingKey.updateMany({
      where: { id: key.id, status: "reg_check" },
      data: { lastResultCode: kisText(issued.resultCd, 20), lastFailReason: kisText(issued.error ?? "카드 등록 결과를 확인하는 중입니다.") },
    });
    if (issued.mayBeCharged) console.error(`[billing-auto] [운영자 확인 필요] 카드 등록 ${key.regNo} — 등록 대신 결제가 됐을 수 있음`);
    return done;
  }
  // 등록 거절 확정(카드 오류 등) — 돈은 빠지지 않았다.
  await moveKey(prisma, key.id, ["reg_check"], "failed", {
    lastResultCode: kisText(issued.resultCd, 20), lastFailReason: kisText(issued.error ?? "카드가 등록되지 않았습니다."),
  });
  return done;
}

/**
 * 받은 빌키로 카드 사용을 시작한다(reg_check → active). 같은 회사의 옛 카드는 deleting → KIS에서 지운다(카드 변경).
 *  · 회사가 없거나 해지됐으면 사용하지 않고 지운다(deleting).
 *  · 저장에 실패하면 KIS에 빌키만 남는다 → 손에 든 빌키로 즉시 지우고, 못 지우면 운영자 확인.
 * @returns 사용을 시작했으면 true
 */
async function activateIssued(keyId: string, cfg: KisMerchant, issued: IssueBillingKeyResult): Promise<boolean> {
  let enc: string;
  try {
    enc = encryptSmsPassword(issued.bid);
  } catch {
    console.error(`[billing-auto] [운영자 확인 필요] 빌키 암호화 실패(열쇠 확인) — 카드 ${keyId}. KIS에서 바로 지웁니다.`);
    await dropUnsavedBid(keyId, cfg, issued.bid);
    return false;
  }
  const card = {
    bid: enc,
    cardName: kisText(issued.fnNm, 40),
    cardNoMasked: kisText(issued.cardNo, 40),
    cardType: kisText(issued.cardType, 20),
    registeredAt: new Date(),
    lastResultCode: kisText(issued.resultCd, 20),
  };
  const oldIds: string[] = [];
  let activated = false;
  try {
    await prisma.$transaction(async (tx) => {
      const key = await tx.pgBillingKey.findUnique({ where: { id: keyId } });
      if (!key || key.status !== "reg_check") throw new Error("등록 확정 중 상태가 아님");
      const c = await tx.company.findUnique({
        where: { id: key.companyId },
        select: { createdAt: true, trialLastDate: true, paidUntil: true, terminatedAt: true, approvedTierIndex: true },
      });
      const now = new Date();
      if (!c || c.terminatedAt) {
        await moveKey(tx, keyId, ["reg_check"], "deleting", { ...card, lastFailReason: "회사 해지로 사용하지 않음 — KIS에서 지움", lastCheckedAt: now });
        return;
      }
      // 카드 변경 — 옛 카드를 먼저 내려놓는다(사용 중 카드 1장 열쇠 liveKey가 비어야 새 카드가 active가 된다).
      const olds = await tx.pgBillingKey.findMany({
        where: { companyId: key.companyId, status: { in: ["active", "paused"] }, id: { not: keyId } },
        select: { id: true, status: true },
      });
      for (const o of olds) {
        const s = o.status === "paused" ? "paused" : "active";
        if (await moveKey(tx, o.id, [s], "deleting", { lastFailReason: "새 카드로 바꿔 지움", lastCheckedAt: now })) oldIds.push(o.id);
      }
      const ok = await moveKey(
        tx, keyId, ["reg_check"], "active",
        { ...card, nextChargeDate: nextChargeDateFor(periodBase(c, now), now), failCount: 0, lastFailReason: null, retryCount: 0 },
        key.companyId
      );
      if (!ok) throw new Error("사용 시작 실패");
      // 동의한 구간 = 이 카드를 신청하며 본 금액의 구간(머리말 · 1단계 검수 M7). 🔴 단 **올리기만** 한다(4단계 검수 중간 1):
      //  초대 링크를 만들며 이미 더 높은 구간에 동의했으면(아직 가입 안 한 사람 포함) 그 동의를 내리지 않고, 새 카드의 동의
      //  근거에도 이어 붙인다 — 안 그러면 그 사람이 가입한 뒤 결제일에 "동의 금액보다 많음"으로 멈추거나 덜 청구된다.
      //  화면은 신청 안내에 그 앞선 동의 금액을 함께 보여 준다(AutoPayBox offer.priorText).
      const approved = Math.max(c.approvedTierIndex ?? -1, key.consentTierIndex ?? -1);
      if (approved >= 0 && approved < PRICE_TIERS.length) {
        await tx.company.update({ where: { id: key.companyId }, data: { approvedTierIndex: approved } });
        if (key.consentTierIndex !== null && approved > key.consentTierIndex) {
          await tx.pgBillingKey.update({
            where: { id: keyId },
            data: { consentTierIndex: approved, consentTotal: withVat(PRICE_TIERS[approved].monthly).total },
          });
        }
      }
      activated = true;
    });
  } catch (e) {
    console.error(`[billing-auto] [운영자 확인 필요] 카드 사용 시작 저장 실패(${errCode(e)}) — 카드 ${keyId}. KIS에서 바로 지웁니다.`);
    oldIds.length = 0; // 묶음이 되돌려졌으니 옛 카드는 그대로다
    await dropUnsavedBid(keyId, cfg, issued.bid);
    return false;
  }
  for (const id of oldIds) startKisDelete(id);
  if (!activated) startKisDelete(keyId); // 회사 해지 — 받은 카드를 지운다
  return activated;
}

/** 저장하지 못한 빌키를 KIS에서 바로 지운다. 지워지면 카드 행을 실패로, 못 지우면 운영자 확인(빌키를 다시 알 방법이 없다). */
async function dropUnsavedBid(keyId: string, cfg: KisMerchant, bid: string): Promise<void> {
  const r = await kispg.deleteBillingKey({ config: cfg, bid }, { timeoutMs: BACKGROUND_DELETE_TIMEOUT_MS });
  if (r.ok) {
    await moveKey(prisma, keyId, ["reg_check"], "failed", { lastFailReason: "카드 정보를 저장하지 못해 등록을 지웠습니다. 다시 신청해 주세요." });
    return;
  }
  console.error(`[billing-auto] [운영자 확인 필요] 카드 ${keyId} — 저장 못 한 빌키를 KIS에서 지우지 못함. KIS 상점관리자에서 등록 카드 삭제`);
  await prisma.pgBillingKey.updateMany({
    where: { id: keyId, status: "reg_check" },
    data: { lastFailReason: "카드 등록 저장 실패 — 운영자 확인 중" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 해지 — 자동결제 해지(관리자) · 회사 해지(운영자). 이미 낸 기간은 끝까지 쓴다(환불 없음).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이 회사의 카드를 모두 내려놓는다: 사용 중·멈춤 → deleting(이 순간부터 청구 안 함) → KIS에서 지우기(뒤에서),
 * 등록 창만 연 카드(빌키 없음) → failed. 등록 결과 확인 중(reg_check)은 정리 작업이 결과를 본 뒤 처리한다.
 *  · KIS 응답을 기다리지 않는다 — 지우기가 실패해도 deleting으로 남아 10분 정리가 다시 지운다(그동안 결제하지 않는다).
 * @returns 지우기 시작한 카드 수
 */
export async function markCompanyCardsForDeletion(companyId: string, reason: string): Promise<number> {
  const keys = await prisma.pgBillingKey.findMany({
    where: { companyId, status: { in: ["active", "paused", "registering"] } },
    select: { id: true, status: true, bid: true },
  });
  const started: string[] = [];
  const now = new Date();
  for (const k of keys) {
    if (k.status === "registering") {
      if (!k.bid) await moveKey(prisma, k.id, ["registering"], "failed", { lastFailReason: kisText(reason) });
      continue;
    }
    const s = k.status === "paused" ? "paused" : "active";
    if (await moveKey(prisma, k.id, [s], "deleting", { lastFailReason: kisText(reason), lastCheckedAt: now })) started.push(k.id);
  }
  for (const id of started) startKisDelete(id);
  return started.length;
}

/**
 * [자동결제 해지] — 관리자. 회사·기록은 그대로, 카드만 지운다.
 *  🔴 회사 결제 선점(payClaimUntil)을 잡고 한다(3단계 검수 중간 3) — 정기 청구가 KIS 응답을 기다리는 사이에 해지하면
 *     "해지했습니다" 직후 결제가 승인돼 돈이 빠질 수 있다. 청구가 진행 중이면 해지하지 않고 잠시 뒤 다시 하게 한다.
 */
export async function cancelAutoPay(companyId: string): Promise<{ ok: boolean; message: string }> {
  const token = await claimCompany(companyId, new Date());
  if (!token) return { ok: false, message: "지금 결제를 처리하고 있습니다. 1~2분 뒤 다시 해지해 주세요." };
  try {
    const regChecking = await prisma.pgBillingKey.count({ where: { companyId, status: "reg_check" } });
    const live = await prisma.pgBillingKey.count({ where: { companyId, status: { in: ["active", "paused", "registering"] } } });
    if (live === 0) {
      return regChecking > 0
        ? { ok: false, message: "카드 등록 결과를 확인하고 있어 지금은 해지할 수 없습니다. 1시간쯤 뒤 다시 해 주세요." }
        : { ok: false, message: "해지할 자동결제 카드가 없습니다." };
    }
    await markCompanyCardsForDeletion(companyId, "관리자가 자동결제를 해지");
    // 이미 보낸 결제의 결과를 모르는 것이 있으면, 그 결제는 결과에 따라 이용 기간에 반영된다(취소하지 않는다 — 이미 낸 결제).
    const pending = await prisma.pgOrder.count({ where: { companyId, orderType: "billing_auto", status: { in: ["check", "cancel_check"] } } });
    return {
      ok: true,
      message:
        "자동결제를 해지했습니다. 앞으로 자동으로 결제되지 않으며, 이미 결제한 이용 기간은 끝까지 쓰실 수 있습니다." +
        (pending > 0 ? " 다만 해지 전에 진행된 결제 1건은 카드사 확인 결과에 따라 결제 내역에 반영됩니다." : ""),
    };
  } finally {
    await releaseCompany(companyId, token);
  }
}

/** KIS 지우기를 기다리지 않고 뒤에서 시작한다. 끊기면 deleting 그대로 남아 10분 정리가 다시 지운다. */
function startKisDelete(keyId: string): void {
  deleteKeyAtKis(keyId, { timeoutMs: BACKGROUND_DELETE_TIMEOUT_MS }).catch((e) =>
    console.error(`[billing-auto] 카드 지우기 실패 — 10분 정리가 다시 지움(카드 ${keyId}): ${errCode(e)}`)
  );
}

/** deleting 카드의 빌키를 KIS에서 지운다. 지워지면 deleted + 빌키 비움, 모르면 deleting 그대로(다시 시도). */
async function deleteKeyAtKis(keyId: string, opts?: { timeoutMs?: number }): Promise<"deleted" | "deleting" | "skip"> {
  const key = await prisma.pgBillingKey.findUnique({ where: { id: keyId } });
  if (!key || key.status !== "deleting") return "skip";
  if (!key.bid) {
    // 빌키 없이 deleting이 될 수는 없다(moveKey가 막는다) — 혹시 생기면 지울 것이 없으니 닫는다.
    await moveKey(prisma, key.id, ["deleting"], "deleted", { deletedAt: new Date() });
    return "deleted";
  }
  const cfg = configForMid(key.pgMid);
  const bid = decryptSmsPassword(key.bid);
  if (!cfg || !bid) {
    await prisma.pgBillingKey.updateMany({ where: { id: key.id, status: "deleting" }, data: { lastCheckedAt: new Date(), retryCount: { increment: 1 } } });
    console.error(`[billing-auto] [운영자 확인 필요] 카드 ${key.regNo} — ${!cfg ? "등록한 상점 설정이 지금 없어" : "빌키를 풀 수 없어(열쇠 확인)"} KIS에서 지우지 못함`);
    return "deleting";
  }
  const r = await kispg.deleteBillingKey({ config: cfg, bid }, opts);
  console.log(`[billing-auto] 카드 지우기 ${key.regNo}: ok=${r.ok} 코드=${r.resultCd || "-"} 결과모름=${r.uncertain}`);
  if (r.ok) {
    // 지운 빌키는 다시 쓸 수 없다 → 저장해 둘 이유가 없다(백업에 남는 빌키 줄이기). 파기 엔진은 bid가 비어야 이 회사를 지운다.
    await moveKey(prisma, key.id, ["deleting"], "deleted", { bid: null, deletedAt: new Date(), lastResultCode: kisText(r.resultCd, 20) });
    return "deleted";
  }
  await prisma.pgBillingKey.updateMany({
    where: { id: key.id, status: "deleting" },
    data: { retryCount: { increment: 1 }, lastCheckedAt: new Date(), lastResultCode: kisText(r.resultCd, 20) },
  });
  return "deleting";
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 10분 정리 — 등록 결과 모름 · KIS 지우기 재시도 · 버려진 등록 창
// ─────────────────────────────────────────────────────────────────────────────

let settling = false;

export async function settleBillingKeys(limit = 20, now: Date = new Date()): Promise<{ regChecked: number; deleted: number; abandoned: number }> {
  const out = { regChecked: 0, deleted: 0, abandoned: 0 };
  if (settling) return out;
  settling = true;
  try {
    // (가) 등록 창만 열고 돌아오지 않은 등록(빌키 없음, 하루 지남) — KIS가 필요 없어 설정이 없어도 닫는다.
    const abandoned = await prisma.pgBillingKey.findMany({
      where: { status: "registering", bid: null, createdAt: { lt: new Date(now.getTime() - ABANDONED_REG_MS) } },
      select: { id: true }, take: 100,
    });
    for (const k of abandoned) {
      if (await moveKey(prisma, k.id, ["registering"], "failed", { lastFailReason: "카드 등록이 끝나지 않아 닫음" })) out.abandoned++;
    }
    if (!billingMerchant()) return out;

    // (나) 등록 결과 모름 — 유예 뒤 KIS 조회: 결제 없음이면 실패, 승인이면 운영자 확인(카드 등록은 원래 조회되지 않는다 — KIS 8번).
    const unknown = await prisma.pgBillingKey.findMany({
      where: { status: "reg_check", OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - REG_CHECK_GRACE_MS) } }] },
      orderBy: { lastCheckedAt: "asc" }, take: limit,
    });
    for (const k of unknown) {
      out.regChecked++;
      try {
        const cfg = configForMid(k.pgMid);
        if (!cfg || !k.pgTid || k.consentTotal === null) {
          console.error(`[billing-auto] [운영자 확인 필요] 카드 등록 결과 모름 ${k.regNo} — 조회할 수 없음(설정·거래번호 없음)`);
          // 조회할 수 없는 채로 7일이 지나면 닫는다 — 그 회사의 새 등록·파기가 영원히 막히지 않게(3단계 검수 중간 4).
          if (now.getTime() - k.createdAt.getTime() > REG_CHECK_GIVE_UP_MS) {
            await moveKey(prisma, k.id, ["reg_check"], "failed", {
              lastFailReason: "카드 등록 결과를 확인하지 못해 닫았습니다. 다시 신청해 주세요(문제가 있으면 고객센터).",
            });
            continue;
          }
          await prisma.pgBillingKey.updateMany({ where: { id: k.id, status: "reg_check" }, data: { lastCheckedAt: new Date(), retryCount: { increment: 1 } } });
          continue;
        }
        const locked = await prisma.pgBillingKey.updateMany({
          where: { id: k.id, status: "reg_check", lastCheckedAt: k.lastCheckedAt },
          data: { lastCheckedAt: new Date(), retryCount: { increment: 1 } },
        });
        if (locked.count !== 1) continue;
        const found = await kispg.inquire({ config: cfg, tid: k.pgTid, ordNo: k.regNo, goodsAmt: k.consentTotal });
        if (found.status === "not_found") {
          // "결제 없음"은 돈이 안 빠졌다는 뜻일 뿐 — 등록은 됐을 수 있다(KIS 상점관리자에서 등록 카드도 확인).
          console.warn(`[billing-auto] 카드 등록 결과 모름 → 실패로 닫음 ${k.regNo}. 등록이 됐을 수 있으니 KIS 상점관리자 확인`);
          await moveKey(prisma, k.id, ["reg_check"], "failed", { lastFailReason: "카드 등록 결과를 확인하지 못했습니다. 다시 신청해 주세요." });
        } else if (found.status === "approved") {
          // 카드 등록 중 **결제가 승인됐다**(등록 대신 결제) — 이 승인을 어느 취소 주소로 되돌려야 하는지 실제 시험 전에는 모른다.
          //  자동 환불은 하지 않고 실패로 닫아 새 등록을 풀어 준 뒤 운영자가 KIS 상점관리자에서 취소한다(3단계 검수 중간 4).
          //  (예전엔 reg_check에 머물러 매시간 같은 경고만 남기고, 그 회사는 새 카드 등록·파기가 영원히 막혔다)
          console.error(`[billing-auto] [운영자 확인 필요] 카드 등록 ${k.regNo} — KIS 조회상 승인(돈이 빠짐 ${found.amt ?? "?"}원). 상점관리자에서 취소(환불)할 것`);
          await moveKey(prisma, k.id, ["reg_check"], "failed", {
            lastFailReason: "카드 등록 중 결제가 승인되어 등록을 멈췄습니다. 고객센터에서 확인 후 환불해 드립니다.",
          });
        } else if (now.getTime() - k.createdAt.getTime() > REG_CHECK_GIVE_UP_MS) {
          console.error(`[billing-auto] [운영자 확인 필요] 카드 등록 결과 모름 ${k.regNo} — 7일 넘게 확인 안 돼 닫음. KIS 상점관리자에서 등록 카드·결제 확인`);
          await moveKey(prisma, k.id, ["reg_check"], "failed", {
            lastFailReason: "카드 등록 결과를 확인하지 못해 닫았습니다. 다시 신청해 주세요(문제가 있으면 고객센터).",
          });
        } else if (k.retryCount + 1 >= DELETE_WARN_TRIES) {
          console.error(`[billing-auto] [운영자 확인 필요] 카드 등록 결과 모름 ${k.regNo} — ${k.retryCount + 1}회 조회에도 확인 안 됨`);
        }
      } catch (e) {
        console.error(`[billing-auto] 카드 등록 결과 확인 실패 ${k.regNo}: ${errCode(e)}`);
      }
    }

    // (다) KIS 지우기 재시도(지워질 때까지 이 카드로 결제하지 않는다).
    const deleting = await prisma.pgBillingKey.findMany({
      where: { status: "deleting", OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - DELETE_RETRY_MS) } }] },
      orderBy: { lastCheckedAt: "asc" }, take: limit, select: { id: true, regNo: true, retryCount: true, lastCheckedAt: true },
    });
    for (const k of deleting) {
      try {
        // 지우기 잠금 — 읽은 lastCheckedAt 그대로일 때만(두 곳이 같은 카드를 동시에 지우지 않게)
        const locked = await prisma.pgBillingKey.updateMany({
          where: { id: k.id, status: "deleting", lastCheckedAt: k.lastCheckedAt },
          data: { lastCheckedAt: new Date() },
        });
        if (locked.count !== 1) continue;
        const s = await deleteKeyAtKis(k.id);
        if (s === "deleted") out.deleted++;
        else if (k.retryCount + 1 >= DELETE_WARN_TRIES) {
          console.error(`[billing-auto] [운영자 확인 필요] 카드 ${k.regNo} — KIS에서 ${k.retryCount + 1}회 지우지 못함. 상점관리자 확인`);
        }
      } catch (e) {
        console.error(`[billing-auto] 카드 지우기 재시도 실패 ${k.regNo}: ${errCode(e)}`);
      }
    }
    return out;
  } finally {
    settling = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 매달 자동 청구(3-2) — 결제일이 된 사용 중 카드로 결제 → 반영 → 후속(다음 결제일·실패 횟수·멈춤)
//   원본: 학원관리 subscriptionAutoChargeService.js. 규칙(학원관리 10-20 ⑦과 같음 · 근태 11-23 계획):
//   만료 3일 전 오전 10시 · 실패하면 다음 날 같은 시각, 총 3번 → 멈춤(paused) · 일시불 · 결과 안내는 화면으로만(문자 없음 — 사장님 11-23).
// ─────────────────────────────────────────────────────────────────────────────

/** 연속 실패 몇 번이면 멈추나(총 3번 — D-3·D-2·D-1). */
const MAX_FAILS = 3;
/** 정기 청구는 이 시각(한국 시각) 이후에만 — 새벽에 카드 승인 문자가 가지 않게. */
const CHARGE_HOUR = 10;
/** 같은 회사의 결제창이 이 시간 안에 열렸으면(ready) 이번에는 청구하지 않는다(직접 결제와 겹침 방지 — 다음 회차에 다시). */
const RECENT_READY_MS = 15 * 60 * 1000;
/** 조회가 "결제 없음"이어도 승인 요청 후 이만큼은 실패로 닫지 않는다(KIS 반영이 늦을 수 있다 — 60분). */
const NOT_FOUND_GRACE_MS = 60 * 60 * 1000;
/** 결과 모름 조회 — 동시 조회 잠금 120초, 처음 20번은 10분마다, 그 뒤 1시간마다, 7일 지나면 운영자 확인. */
const CHECK_LOCK_MS = 120 * 1000;
const FAST_RETRIES = 20;
const SLOW_INTERVAL_MS = 60 * 60 * 1000;
const GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;

export type ChargeOutcome =
  | "charged" // 결제를 보냈다(결과는 주문 상태로)
  | "not_due" | "rescheduled" | "postponed" | "paused" | "busy" | "skip";

/** 사용 중 카드를 멈춘다(빌키는 남김 — 관리자가 카드를 다시 등록하면 옛 카드는 지워진다). 이미 멈춤·해지면 false. */
async function pauseKey(keyId: string, companyId: string, reason: string, failCount?: number): Promise<boolean> {
  return moveKey(prisma, keyId, ["active"], "paused", {
    pausedAt: new Date(), lastFailReason: kisText(reason), ...(failCount !== undefined ? { failCount } : {}),
  }, companyId);
}
/** 다음 결제일을 내일로(같은 날 두 번 시도하지 않게). 사용 중 카드만. */
async function postponeKey(keyId: string, now: Date, reason?: string): Promise<void> {
  await prisma.pgBillingKey.updateMany({
    where: { id: keyId, status: "active" },
    data: { nextChargeDate: tomorrowStart(now), ...(reason ? { lastFailReason: kisText(reason) } : {}) },
  });
}
/** 실패 1회를 센다 — 3번째면 멈춤, 아니면 내일 다시. 사용 중 카드만(해지·변경·멈춤이면 아무것도 안 함). */
async function recordFailure(keyId: string, attemptAt: Date, reason: string, resultCode?: string | null): Promise<void> {
  const now = attemptAt; // "내일"은 결과가 닫힌 때가 아니라 **시도한 날** 기준(자정 넘어 닫혀도 하루가 빠지지 않게 — 검수 경미 2)
  const k = await prisma.pgBillingKey.findUnique({ where: { id: keyId }, select: { status: true, failCount: true, companyId: true } });
  if (!k || k.status !== "active") return;
  const n = k.failCount + 1;
  if (n >= MAX_FAILS) {
    await pauseKey(keyId, k.companyId, `${MAX_FAILS}번 연속 결제에 실패해 자동결제를 멈췄습니다 — ${reason}`, n);
    console.warn(`[billing-auto] 자동결제 ${MAX_FAILS}회 실패로 멈춤 — 회사 ${k.companyId.slice(0, 8)}`);
    return;
  }
  await prisma.pgBillingKey.updateMany({
    where: { id: keyId, status: "active", failCount: k.failCount },
    data: { failCount: n, lastFailReason: kisText(reason), lastResultCode: kisText(resultCode ?? null, 20), nextChargeDate: tomorrowStart(now) },
  });
}

let charging = false;

/** 정기 청구 — 10분 정리가 부른다. 오전 10시 전에는 아무것도 하지 않는다. */
export async function chargeDueBillingKeys(now: Date = new Date(), limit = 50): Promise<{ attempted: number }> {
  const out = { attempted: 0 };
  if (charging || now.getHours() < CHARGE_HOUR) return out;
  if (!billingMerchant()) return out;
  charging = true;
  try {
    const due = await prisma.pgBillingKey.findMany({
      where: { status: "active", nextChargeDate: { lte: now } },
      orderBy: { nextChargeDate: "asc" }, take: limit, select: { id: true, regNo: true },
    });
    for (const k of due) {
      try {
        if ((await chargeKey(k.id)) === "charged") out.attempted++;
      } catch (e) {
        console.error(`[billing-auto] 정기 청구 오류 — 카드 ${k.regNo}: ${errCode(e)}`);
      }
    }
    return out;
  } finally {
    charging = false;
  }
}

/**
 * 카드 한 장으로 이번 회차를 청구한다. 정기 청구·카드 등록 직후(결제일이 이미 지난 경우) 공통.
 *  🔴 회사 결제 선점(payClaimUntil)을 잡은 **뒤** 다시 확인한다 — 직접 결제와 겹쳐 두 번 청구·2개월 연장되지 않게(학원관리 4단계 검수 치명 1).
 */
export async function chargeKey(keyId: string): Promise<ChargeOutcome> {
  const first = await prisma.pgBillingKey.findUnique({ where: { id: keyId }, select: { companyId: true, status: true } });
  if (!first || first.status !== "active") return "skip";
  const token = await claimCompany(first.companyId, new Date());
  if (!token) return "busy"; // 같은 회사의 다른 결제가 처리 중 — 다음 회차(10분 뒤)에 다시
  let orderId: string | null = null;
  try {
    const now = new Date();
    const key = await prisma.pgBillingKey.findUnique({ where: { id: keyId } });
    if (!key || key.status !== "active" || !key.bid) return "skip";
    if (!key.nextChargeDate || key.nextChargeDate.getTime() > now.getTime()) return "not_due";
    const cfg = configForMid(key.pgMid);
    if (!cfg) {
      console.error(`[billing-auto] [운영자 확인 필요] 카드 ${key.regNo} — 등록한 상점 설정이 지금 없어 청구하지 못함`);
      return "skip";
    }
    const c = await prisma.company.findUnique({
      where: { id: key.companyId },
      select: {
        name: true, bizRegNo: true, companyPhone: true, managerPhone: true,
        createdAt: true, trialLastDate: true, paidUntil: true, terminatedAt: true, approvedTierIndex: true,
      },
    });
    if (!c || c.terminatedAt) {
      await markCompanyCardsForDeletion(key.companyId, "회사 해지로 자동결제 카드 지움");
      return "skip";
    }
    // 확인 중인 결제(돈이 빠졌는지 모름)가 있으면 오늘은 청구하지 않는다.
    const pending = await prisma.pgOrder.count({ where: { companyId: key.companyId, status: { in: ["check", "cancel_check"] } } });
    if (pending > 0) {
      await postponeKey(key.id, now);
      return "postponed";
    }
    // 방금 결제창을 연 관리자가 있으면(직접 결제 중일 수 있다) 이번에는 건너뛴다 — 10분 뒤 다시.
    const recentReady = await prisma.pgOrder.count({
      where: { companyId: key.companyId, status: "ready", createdAt: { gt: new Date(now.getTime() - RECENT_READY_MS) } },
    });
    if (recentReady > 0) return "busy";
    // 이용 기간이 결제일보다 많이 남았으면(직접 결제·운영자 기간 변경) 결제일만 다시 잡는다.
    const base = periodBase(c, now);
    const due = nextChargeDateFor(base, now);
    if (due.getTime() > startOfDay(now).getTime()) {
      await prisma.pgBillingKey.updateMany({ where: { id: key.id, status: "active" }, data: { nextChargeDate: due } });
      return "rescheduled";
    }

    const heads = await countHeads(key.companyId);
    const q = quoteFor(billableCount(heads.employees, heads.admins));
    const amount = autoChargeAmount(q, c.approvedTierIndex ?? key.consentTierIndex);
    if (amount.kind === "none") {
      // 요금 대상 인원이 없으면 청구하지 않는다(실패로 세지 않음) — 내일 다시 본다.
      await postponeKey(key.id, now, "요금 대상 인원이 없어 이번에는 청구하지 않았습니다.");
      return "postponed";
    }
    if (amount.kind === "quote") {
      await pauseKey(key.id, key.companyId, "요금표를 넘는 인원이라 자동결제를 멈췄습니다 — 고객센터로 연락해 주세요.");
      return "paused";
    }
    if (amount.kind === "no_consent") {
      await pauseKey(key.id, key.companyId, "동의하신 금액 정보가 없어 자동결제를 멈췄습니다 — 카드를 다시 등록해 주세요.");
      return "paused";
    }
    // 🔴 동의한 **금액**보다 많으면 청구하지 않는다(3단계 검수 중간 2). 구간 번호만 보면, 요금표 가격을 올리거나 구간을 다시 나눠
    //    배포했을 때 자동결제 고객 전원에게 동의 없이 오른 금액이 빠진다(1단계 검수 M7·전자상거래법 제13조 ⑥ 취지).
    //    멈춤 → 관리자가 [카드 다시 등록하기]에서 새 금액을 보고 다시 동의한다.
    if (key.consentTotal === null || amount.total > key.consentTotal) {
      await pauseKey(key.id, key.companyId, "요금이 바뀌어 동의하신 금액보다 많아 자동결제를 멈췄습니다 — 새 금액을 확인하고 카드를 다시 등록해 주세요.");
      return "paused";
    }
    const max = readKispgConfig().maxAmount ?? KIS_MAX_TOTAL;
    if (amount.total > max) {
      await pauseKey(key.id, key.companyId, "카드 1회 결제 한도를 넘는 금액이라 자동결제를 멈췄습니다 — 고객센터로 연락해 주세요.");
      return "paused";
    }
    const tel = phoneDigits(c.managerPhone) ?? phoneDigits(c.companyPhone);
    if (!tel) {
      await recordFailure(key.id, now, "담당자 연락처가 없어 결제하지 못했습니다 — [회사정보]에 연락처를 입력해 주세요.");
      return "postponed";
    }
    const bid = decryptSmsPassword(key.bid);
    if (!bid) {
      console.error(`[billing-auto] [운영자 확인 필요] 카드 ${key.regNo} — 빌키를 풀 수 없어(열쇠 확인) 청구하지 못함`);
      await pauseKey(key.id, key.companyId, "카드 정보를 읽지 못해 자동결제를 멈췄습니다 — 카드를 다시 등록해 주세요.");
      return "paused";
    }

    const orderNo = makeOrderNo(now);
    const productName = `가온 근태관리 1개월 (${amount.label}) 자동결제`;
    try {
      const o = await prisma.pgOrder.create({
        data: {
          companyId: key.companyId, userId: null, orderNo, orderType: "billing_auto", billingKeyId: key.id, pgMid: key.pgMid,
          // 회차 열쇠 = 회사:새 기간 시작일(한국 시간 — 1단계 검수 경미 8). 같은 회차에 살아 있는 주문은 DB가 1개만 허용한다.
          cycleKey: `${key.companyId}:${toISODate(base)}`, billingCycleDate: base,
          productName, employees: q.employees, headEmployees: heads.employees, headAdmins: heads.admins,
          buyerName: c.name, buyerBizRegNo: c.bizRegNo, tierIndex: amount.tierIndex, termMonths: 1, payMethod: "CARD",
          supplyAmount: amount.monthly, vatAmount: amount.vat, totalAmount: amount.total,
          // 바로 check — 보내는 순간부터 "돈이 빠졌는지 모름"으로 다룬다(학원관리와 같음).
          status: "check", approveRequestedAt: now, lastCheckedAt: now,
        },
      });
      orderId = o.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // 이 회차의 살아 있는 주문이 이미 있다 — 그 결과가 후속 처리를 한다.
        await postponeKey(key.id, now);
        return "postponed";
      }
      throw e;
    }
    // 결과와 상관없이 오늘은 다시 시도하지 않는다 — 성공하면 후속 처리가 새 결제일로 고친다.
    await prisma.pgBillingKey.updateMany({ where: { id: key.id, status: "active" }, data: { nextChargeDate: tomorrowStart(now) } });

    const paid = await kispg.billingPay({
      config: cfg, bid, ordNo: orderNo, goodsNm: productName, goodsAmt: amount.total,
      ordNm: fitBytes(c.name.trim() || "가온 근태관리 고객", 30), ordTel: tel,
    });
    console.log(`[billing-auto] 정기 청구 ${orderNo}: ok=${paid.ok} 코드=${paid.resultCd || "-"} 결과모름=${paid.uncertain} 금액불일치=${paid.amountMismatch}`);
    await settleAutoCharge(orderId, cfg, paid);
    return "charged";
  } finally {
    await releaseCompany(first.companyId, token);
    if (orderId) await followUpAutoChargeOrders().catch((e) => console.error(`[billing-auto] 후속 처리 실패: ${errCode(e)}`));
  }
}

/** 빌키 결제 응답을 정리한다. 확정 실패여도 바로 실패로 닫지 않는다 — 60분 뒤 조회로 "결제 없음"을 확인한 뒤 닫는다(학원관리와 같음). */
async function settleAutoCharge(orderId: string, cfg: KisMerchant, paid: BillingPayResult): Promise<void> {
  const tid = kisText(paid.tid, 40);
  if (tid) {
    try {
      await prisma.pgOrder.updateMany({ where: { id: orderId, status: "check", pgTid: null }, data: { pgTid: tid } });
    } catch (e) {
      console.error(`[billing-auto] [운영자 확인 필요] 자동결제 거래번호 저장 실패(${errCode(e)}) — 주문 ${orderId}`);
    }
  }
  if (paid.ok) {
    const r = await applyPaidOrder(orderId, {
      amt: paid.amt ?? 0, appNo: paid.appNo, payMethod: paid.payMethod, cardNo: paid.cardNo, cardType: paid.cardType,
      cardName: paid.fnNm, code: paid.resultCd, msg: paid.resultMsg,
    });
    if (r.outcome === "blocked") await billingCancelCheck(orderId, cfg, paid.amt ?? null, r.reason);
    return;
  }
  if (paid.amountMismatch) {
    await billingCancelCheck(orderId, cfg, paid.amt ?? null, "승인 금액이 주문 금액과 달라 자동 취소");
    return;
  }
  // 확정 거절(카드 한도 초과 등 — 돈이 빠지지 않았다고 KIS가 답함)이면 **바로 한 번 조회**해서 "결제 없음"이면 즉시 실패로 닫는다
  //  (3단계 검수 중간 5 — 일반 결제 settleApprove와 같은 규칙). 예전엔 60분 동안 "확인 중"으로 남아 거절 사유도 안 보이고 직접 결제도 막혔다.
  if (!paid.uncertain && !paid.mayBeCharged) {
    const o = await prisma.pgOrder.findUnique({ where: { id: orderId }, select: { orderNo: true, totalAmount: true, pgTid: true } });
    if (o) {
      const r = await kispg.inquire({ config: cfg, tid: o.pgTid ?? undefined, ordNo: o.orderNo, goodsAmt: o.totalAmount });
      if (r.status === "not_found") {
        await moveOrder(prisma, orderId, ["check"], "failed", {
          failReason: kisText(paid.error ?? "승인되지 않았습니다."), pgResultCode: kisText(paid.resultCd, 20), pgResultMsg: kisText(paid.resultMsg),
        });
        return;
      }
    }
  }
  // 결과 모름(또는 거절인데 조회가 결제 없음이 아님) — check로 두고 10분 정리가 조회로 닫는다.
  await prisma.pgOrder.updateMany({
    where: { id: orderId, status: "check" },
    data: {
      failReason: kisText(paid.uncertain ? `결과 모름 — ${paid.error ?? ""}` : (paid.error ?? "승인되지 않았습니다.")),
      pgResultCode: kisText(paid.resultCd, 20), pgResultMsg: kisText(paid.resultMsg),
    },
  });
}

/** 자동결제 주문을 취소한다(cancel_check로 옮긴 뒤 빌링 취소). 결과가 애매하면 cancel_check로 두고 정리가 다시 한다. */
async function billingCancelCheck(orderId: string, cfg: KisMerchant, amt: number | null, reason: string): Promise<void> {
  const moved = await moveOrder(prisma, orderId, ["check"], "cancel_check", {
    failReason: kisText(reason), ...(amt !== null ? { pgAmount: amt } : {}),
  });
  if (!moved) return;
  await runBillingCancel(orderId, cfg);
}

/** cancel_check 자동결제 주문을 KIS **빌링 취소**로 취소한다(일반 결제 취소 주소와 다르다). */
async function runBillingCancel(orderId: string, cfg: KisMerchant): Promise<void> {
  const o = await prisma.pgOrder.findUnique({ where: { id: orderId } });
  if (!o || o.status !== "cancel_check") return;
  let tid = o.pgTid;
  let canAmt = o.pgAmount;
  if (!tid || canAmt === null) {
    const r = await kispg.inquire({ config: cfg, tid: tid ?? undefined, ordNo: o.orderNo, goodsAmt: o.totalAmount });
    if (r.status === "cancelled") {
      await moveOrder(prisma, o.id, ["cancel_check"], "cancelled", { cancelledAt: new Date() });
      return;
    }
    if (r.status === "not_found") {
      if (Date.now() - (o.approveRequestedAt ?? o.createdAt).getTime() <= NOT_FOUND_GRACE_MS) return;
      await moveOrder(prisma, o.id, ["cancel_check"], "cancelled", { cancelledAt: new Date(), failReason: kisText(`${o.failReason ?? ""} / 조회 결과 결제 없음`) });
      return;
    }
    if (r.status !== "approved" || r.amt === null || !kisText(r.tid, 40)) return; // 모르면 다음 정리 때
    tid = tid ?? kisText(r.tid, 40);
    canAmt = canAmt ?? r.amt;
    await prisma.pgOrder.updateMany({ where: { id: o.id, status: "cancel_check" }, data: { pgTid: tid, pgAmount: canAmt } });
  }
  if (!tid || canAmt === null) return;
  const c = await kispg.billingCancel({ config: cfg, tid, canAmt, canMsg: o.failReason ?? "자동 취소", ordNo: o.orderNo });
  if (c.ok || c.alreadyCancelled) {
    await moveOrder(prisma, o.id, ["cancel_check"], "cancelled", { cancelledAt: new Date() });
  } else {
    console.warn(`[billing-auto] 자동결제 취소가 끝나지 않음(정리 작업이 다시 시도) — 주문 ${o.orderNo}: ${c.error ?? ""}`);
  }
}

/**
 * 결과가 정해진 자동결제 주문마다 **한 번만** 후속 처리(followedUpAt): 정기 청구 직후와 10분 정리(늦게 정해진 결과) 모두 이것으로.
 *  paid → 실패 횟수 0, 다음 결제일 = 새 이용 기간 시작일 3일 전 / failed → 실패 +1·내일 다시, 3번째면 멈춤 / cancelled → 멈춤.
 *  카드가 사용 중이 아니면(해지·변경·멈춤) 아무것도 하지 않는다.
 */
export async function followUpAutoChargeOrders(limit = 50): Promise<number> {
  const orders = await prisma.pgOrder.findMany({
    where: { orderType: "billing_auto", status: { in: ["paid", "failed", "cancelled"] }, followedUpAt: null },
    orderBy: { createdAt: "asc" }, take: limit,
    select: { id: true, status: true, billingKeyId: true, companyId: true, failReason: true, pgResultMsg: true, pgResultCode: true, approveRequestedAt: true, createdAt: true },
  });
  let n = 0;
  for (const o of orders) {
    const claimed = await prisma.pgOrder.updateMany({ where: { id: o.id, followedUpAt: null }, data: { followedUpAt: new Date() } });
    if (claimed.count !== 1 || !o.billingKeyId) continue;
    n++;
    const now = new Date();
    try {
      if (o.status === "paid") {
        const c = await prisma.company.findUnique({ where: { id: o.companyId }, select: { createdAt: true, trialLastDate: true, paidUntil: true } });
        if (!c) continue;
        await prisma.pgBillingKey.updateMany({
          where: { id: o.billingKeyId, status: "active" },
          data: { failCount: 0, lastFailReason: null, lastResultCode: kisText(o.pgResultCode, 20), nextChargeDate: nextChargeDateFor(periodBase(c, now), now) },
        });
      } else if (o.status === "failed") {
        // 화면·알림에 보이는 사유는 KIS가 준 거절 문구만(예: 잔액 부족). "결과 모름 — 응답 시간 초과" 같은 내부 문구는 보이지 않는다(검수 경미 8).
        await recordFailure(o.billingKeyId, o.approveRequestedAt ?? o.createdAt, o.pgResultMsg || "카드 결제가 승인되지 않았습니다.", o.pgResultCode);
      } else {
        // 취소된 회차를 다음 날 또 청구하지 않게 멈춘다(관리자가 확인 후 카드를 다시 등록하거나 직접 결제).
        await pauseKey(o.billingKeyId, o.companyId, `결제가 자동으로 취소되어 자동결제를 멈췄습니다${o.failReason ? ` — ${o.failReason}` : ""}`);
      }
    } catch (e) {
      console.error(`[billing-auto] 자동결제 후속 처리 오류(다음 정리 때 다시) — 주문 ${o.id}: ${errCode(e)}`);
      // 표시만 찍고 처리를 못 했으면 실패 횟수가 영원히 안 센다(검수 경미 3) → 표시를 되돌려 다시 처리하게 한다.
      await prisma.pgOrder.updateMany({ where: { id: o.id }, data: { followedUpAt: null } }).catch(() => undefined);
    }
  }
  return n;
}

let reconcilingAuto = false;

/** 10분 정리 — 자동결제 주문의 결과 모름(check)·취소 중(cancel_check)을 **빌링 상점**으로 조회·취소해 닫는다. */
export async function reconcileAutoChargeOrders(limit = 20, now: Date = new Date()): Promise<{ checked: number }> {
  const out = { checked: 0 };
  if (reconcilingAuto) return out;
  reconcilingAuto = true;
  try {
    if (!billingMerchant()) return out;
    const lockBefore = new Date(now.getTime() - CHECK_LOCK_MS);
    const giveUpBefore = new Date(now.getTime() - GIVE_UP_MS);
    const stuck = await prisma.pgOrder.count({
      where: { status: { in: ["check", "cancel_check"] }, orderType: "billing_auto", createdAt: { lt: giveUpBefore } },
    });
    if (stuck > 0) console.error(`[billing-auto] [운영자 확인 필요] 7일이 넘도록 닫히지 않은 자동결제 ${stuck}건 — 자동 정리를 멈췄습니다`);
    const pending = await prisma.pgOrder.findMany({
      where: {
        status: { in: ["check", "cancel_check"] }, orderType: "billing_auto", createdAt: { gte: giveUpBefore },
        AND: [
          { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: lockBefore } }] },
          { OR: [{ retryCount: { lt: FAST_RETRIES } }, { lastCheckedAt: { lt: new Date(now.getTime() - SLOW_INTERVAL_MS) } }] },
        ],
      },
      orderBy: { lastCheckedAt: "asc" }, take: limit,
    });
    for (const o of pending) {
      const cfg = configForMid(o.pgMid);
      if (!cfg) {
        console.error(`[billing-auto] [운영자 확인 필요] 자동결제 ${o.orderNo}의 상점ID가 지금 설정과 달라 조회하지 못함`);
        continue;
      }
      const locked = await prisma.pgOrder.updateMany({
        where: { id: o.id, status: o.status, lastCheckedAt: o.lastCheckedAt },
        data: { lastCheckedAt: new Date(), retryCount: { increment: 1 } },
      });
      if (locked.count !== 1) continue;
      out.checked++;
      try {
        if (o.status === "cancel_check") {
          await runBillingCancel(o.id, cfg);
          continue;
        }
        const sinceApprove = Date.now() - (o.approveRequestedAt ?? o.createdAt).getTime();
        const r = await kispg.inquire({ config: cfg, tid: o.pgTid ?? undefined, ordNo: o.orderNo, goodsAmt: o.totalAmount });
        const foundTid = kisText(r.tid, 40);
        if (r.status === "approved" && !o.pgTid && foundTid) {
          await prisma.pgOrder.updateMany({ where: { id: o.id, status: "check", pgTid: null }, data: { pgTid: foundTid } });
        }
        if (r.status === "approved" && !r.uncertain && !r.amountMismatch) {
          const token = await claimCompany(o.companyId, new Date());
          const companyExists = (await prisma.company.count({ where: { id: o.companyId } })) > 0;
          if (!token && companyExists) continue; // 다른 결제가 선점 중 — 다음 회차에
          try {
            const a = await applyPaidOrder(o.id, { amt: r.amt ?? o.totalAmount, appNo: r.appNo, payMethod: r.payMethod, code: r.resultCd, msg: r.resultMsg });
            if (a.outcome === "blocked") await billingCancelCheck(o.id, cfg, r.amt ?? null, a.reason);
          } finally {
            if (token) await releaseCompany(o.companyId, token);
          }
        } else if (r.status === "approved" && r.amountMismatch) {
          await billingCancelCheck(o.id, cfg, r.amt, "승인 금액이 주문 금액과 달라 자동 취소");
        } else if (r.status === "cancelled") {
          await moveOrder(prisma, o.id, ["check"], "cancelled", { cancelledAt: new Date(), failReason: kisText("KIS 조회 결과 취소된 결제") });
        } else if (r.status === "not_found" && sinceApprove > NOT_FOUND_GRACE_MS) {
          // 확정: 돈이 빠지지 않았다 → 실패. 후속 처리가 실패 횟수를 세고 내일 다시(3번째면 멈춤).
          await moveOrder(prisma, o.id, ["check"], "failed", { failReason: kisText(o.failReason ?? "KIS 조회 결과 결제 없음") });
        }
      } catch (e) {
        console.error(`[billing-auto] 자동결제 정리 중 오류 — 주문 ${o.orderNo}: ${errCode(e)}`);
      }
    }
    return out;
  } finally {
    reconcilingAuto = false;
    await followUpAutoChargeOrders().catch((e) => console.error(`[billing-auto] 후속 처리 실패: ${errCode(e)}`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 새 금액 동의(3-3) — 인원이 늘어 윗구간이 됐을 때 관리자가 [새 금액에 동의]를 눌러야 그 금액으로 청구한다(1단계 검수 M7).
//    (초대 링크를 만들 때 받는 동의는 4단계)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 지금 구간으로 동의를 올린다. seenTierIndex = 관리자가 화면에서 **본** 구간 — 그사이 인원이 바뀌어 다른 금액이 됐으면
 * 동의하지 않는다(보지 않은 금액에 동의시키지 않는다). 동의 근거는 사용 중 카드 행에 새로 남긴다.
 */
export async function approveCurrentTier(companyId: string, seenTierIndex: number): Promise<{ ok: boolean; message: string }> {
  const card = await prisma.pgBillingKey.findFirst({ where: { companyId, status: { in: ["active", "paused"] } }, select: { id: true, status: true } });
  if (!card) return { ok: false, message: "사용 중인 자동결제 카드가 없습니다." };
  // 멈춘 카드는 동의해도 결제되지 않는다 — 거짓 안내를 하지 않게 카드 다시 등록으로 보낸다(검수 경미 5).
  if (card.status === "paused") return { ok: false, message: "자동결제가 멈춰 있습니다. [카드 다시 등록하기]에서 새 금액으로 신청해 주세요." };
  const heads = await countHeads(companyId);
  const q = quoteFor(billableCount(heads.employees, heads.admins));
  if (q.kind !== "tier") return { ok: false, message: "지금은 동의할 요금이 없습니다." };
  if (!Number.isInteger(seenTierIndex) || q.tierIndex !== seenTierIndex) {
    return { ok: false, message: "그사이 인원이 바뀌어 금액이 달라졌습니다. 화면을 새로 고쳐 금액을 다시 확인해 주세요." };
  }
  if (q.total > (readKispgConfig().maxAmount ?? KIS_MAX_TOTAL)) {
    return { ok: false, message: "카드 1회 결제 한도를 넘는 금액이라 자동결제로 받을 수 없습니다. 고객센터로 연락해 주세요." };
  }
  const now = new Date();
  // 올리기만 한다(4단계 검수 중간 1) — 그사이 다른 관리자가 초대 링크로 더 높게 동의했으면 낮추지 않는다.
  await prisma.$transaction([
    prisma.company.updateMany({
      where: { id: companyId, OR: [{ approvedTierIndex: null }, { approvedTierIndex: { lt: q.tierIndex } }] },
      data: { approvedTierIndex: q.tierIndex },
    }),
    prisma.pgBillingKey.updateMany({
      where: { id: card.id, OR: [{ consentTierIndex: null }, { consentTierIndex: { lt: q.tierIndex } }] },
      data: { consentTierIndex: q.tierIndex, consentTotal: q.total, consentedAt: now },
    }),
  ]);
  return { ok: true, message: `동의하셨습니다. 다음 자동결제부터 월 ${q.total.toLocaleString("ko-KR")}원(부가세 포함)으로 결제됩니다.` };
}

/**
 * 이 회사의 사용 중 카드 결제일을 지금 이용 기간 기준으로 다시 잡는다(3단계 검수 중간 6).
 *  · 결제일은 등록·결제 성공 때만 계산되므로, 운영자가 무료 기간을 **줄이면** 옛 결제일까지 청구되지 않아 기간이 빈다.
 *  · 운영자 무료 기간 변경(app/actions/operator-companies.ts)이 부른다. ⏳ 6단계 운영자 결제 취소로 paidUntil을 되돌릴 때도 부를 것.
 */
export async function rescheduleCompanyCards(companyId: string, now: Date = new Date()): Promise<void> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { createdAt: true, trialLastDate: true, paidUntil: true } });
  if (!c) return;
  await prisma.pgBillingKey.updateMany({
    where: { companyId, status: "active" },
    data: { nextChargeDate: nextChargeDateFor(periodBase(c, now), now) },
  });
}
