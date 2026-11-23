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
import { periodBase, phoneDigits, fitBytes } from "@/lib/billing-pay";
import { moveKey, kisText } from "@/lib/pg-state";

/** 카드 등록 번호 — "HRB-" + 한국 시각 14자리 + 난수 6자리. 결과 받기에서 이 모양이 아니면 카드 등록으로 보지 않는다. */
export const REG_NO_RE = /^HRB-\d{14}-[0-9a-f]{6}$/;
/** 이용 기간이 끝나기 며칠 전에 청구하나(학원관리 사장님 결정 ⑦-1과 같음 — 실패해도 이틀 더 시도할 여유). */
export const CHARGE_DAYS_BEFORE = 3;
/** 등록 창만 열고 돌아오지 않은 등록은 하루 뒤 실패로 닫는다(빌키가 없으니 돈·KIS 정리는 필요 없다). */
const ABANDONED_REG_MS = 24 * 60 * 60 * 1000;
/** 등록 결과 모름(reg_check)은 이 시간이 지나야 KIS 조회 "결제 없음"을 믿고 실패로 닫는다(일반 결제와 같은 60분). */
const REG_CHECK_GRACE_MS = 60 * 60 * 1000;
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

/**
 * 자동결제로 청구할 금액 = min(지금 인원 구간, 동의한 구간)(1단계 검수 M7).
 *  · 동의한 구간이 없으면 청구하지 않는다(null) — 동의 없이 돈을 빼지 않는다.
 *  · 인원이 줄면 낮은 구간(고객에게 유리 — 동의 불필요), 늘면 동의한 구간에서 멈춘다.
 */
export function autoChargeAmount(
  q: Quote,
  approvedTierIndex: number | null
): { kind: "charge"; tierIndex: number; label: string; monthly: number; vat: number; total: number; capped: boolean } | { kind: "none" | "quote" | "no_consent" } {
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
  return prisma.pgBillingKey.findFirst({
    where: { regNo, companyId },
    select: { regNo: true, status: true, cardName: true, cardNoMasked: true, nextChargeDate: true, lastFailReason: true, consentTotal: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 카드 등록 시작 — 동의 확인 → 카드 행(registering) → KIS 카드 등록 창 값
// ─────────────────────────────────────────────────────────────────────────────

export type StartRegResult =
  | { ok: true; regNo: string; action: string; fields: Record<string, string> }
  | { ok: false; error: string };

export async function startCardRegistration(
  input: { companyId: string; userId: string; consent: boolean },
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
        select: { createdAt: true, trialLastDate: true, paidUntil: true, terminatedAt: true },
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
      // 동의한 구간 = 이 카드를 신청하며 본 금액의 구간(머리말 · 1단계 검수 M7).
      await tx.company.update({ where: { id: key.companyId }, data: { approvedTierIndex: key.consentTierIndex } });
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

/** [자동결제 해지] — 관리자. 회사·기록은 그대로, 카드만 지운다. */
export async function cancelAutoPay(companyId: string): Promise<{ ok: boolean; message: string }> {
  const n = await markCompanyCardsForDeletion(companyId, "관리자가 자동결제를 해지");
  if (n === 0) return { ok: false, message: "해지할 자동결제 카드가 없습니다." };
  return { ok: true, message: "자동결제를 해지했습니다. 앞으로 자동으로 결제되지 않으며, 이미 결제한 이용 기간은 끝까지 쓰실 수 있습니다." };
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
          console.error(`[billing-auto] [운영자 확인 필요] 카드 등록 ${k.regNo} — KIS 조회상 승인(돈이 빠짐). 상점관리자에서 취소 확인`);
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
