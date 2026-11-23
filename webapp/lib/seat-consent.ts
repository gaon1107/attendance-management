// [인원 증가 동의] 요금 대상 인원이 늘어 요금 구간이 오르면, 늘리기 **전에** 새 금액을 보여 주고 동의를 받는다.
//   2026-11-23 결제 4단계(사장님 "추천대로 진행"). 계획서 plan-근태결제-개발.md "4단계", 요금 규칙 plan-구독결제-요금제.md 3장.
//
// 왜: 홈페이지 FAQ가 "올리기 전에 금액을 먼저 보여 드리고 동의를 받습니다"라고 약속한다. 자동결제(3단계)는 동의한 금액까지만
//     청구하므로, 여기서 동의를 받지 않으면 인원이 늘어도 요금이 오르지 않는다(덜 받는다).
// 사장님 결정(11-23): 자동결제를 안 쓰는 회사(체험·직접 결제)도 **동의만** 받고 차액은 받지 않는다 — 다음 결제부터 새 금액.
//
// 묻는 곳(요금 대상 인원이 늘어나는 4곳): 초대 링크 만들기 · 직원 직접 추가 · 퇴사자 복직 · 관리자 해제.
//  직원이 초대 링크로 가입하는 화면은 묻지 않는다(링크를 만든 관리자가 이미 동의했다 — 그래서 안 쓴 초대 링크도 인원으로 센다).
//
// 쓰는 법(서버 액션):
//   const gate = await checkSeatConsent(me, delta, formData.get("seatConsent"));
//   if (!gate.ok) return { seatConsent: gate.preview };   // 화면이 확인 창을 띄운다
//   ...실제 등록...
//   await gate.commit();                                  // 등록이 **성공한 뒤에만** 동의를 저장한다
// ⚠️ 서버 전용.
import { prisma } from "@/lib/db";
import { countHeads, billableCount } from "@/lib/pricing-server";
import { quoteFor, PRICE_TIERS, tierLabel, withVat } from "@/lib/pricing";
import { logAdminAction } from "@/lib/audit";

/** 이번 변경으로 늘어나는 사람 수(재직 직원·사람 관리자 각각). 관리자 해제 = { employees: +1, admins: -1 }. */
export type SeatDelta = { employees: number; admins: number };

/** 화면에 보여 줄 값 — 금액은 부가세 포함 카드 청구액. */
export type SeatPreview =
  | { needsConsent: false }
  | {
      needsConsent: true;
      quote: false;
      /** 화면이 다시 보낼 동의 값(=새 구간 번호). 서버 계산과 다르면 진행하지 않는다. */
      token: string;
      projected: number;
      fromLabel: string;
      fromTotal: number;
      toLabel: string;
      toTotal: number;
    }
  | { needsConsent: true; quote: true; token: "quote"; projected: number };

type Actor = { id: string; companyId: string; name: string };

/** 아직 안 쓴(만료 전) 초대 링크 수 — 링크 하나는 곧 한 사람이다. */
async function pendingInvites(companyId: string): Promise<number> {
  return prisma.invite.count({ where: { companyId, usedAt: null, expiresAt: { gt: new Date() } } });
}

type Plan = { preview: SeatPreview; toTierIndex: number | null; toTotal: number | null; fromLabel: string | null; fromTotal: number | null };

async function plan(companyId: string, delta: SeatDelta): Promise<Plan> {
  const none: Plan = { preview: { needsConsent: false }, toTierIndex: null, toTotal: null, fromLabel: null, fromTotal: null };
  const [heads, invites, c] = await Promise.all([
    countHeads(companyId),
    pendingInvites(companyId),
    prisma.company.findUnique({ where: { id: companyId }, select: { approvedTierIndex: true } }),
  ]);
  if (!c) return none;
  const nowCount = billableCount(heads.employees + invites, heads.admins);
  const nextCount = billableCount(heads.employees + invites + delta.employees, heads.admins + delta.admins);
  if (nextCount <= nowCount) return none;
  const cur = quoteFor(nowCount);
  const next = quoteFor(nextCount);
  if (next.kind === "none") return none;
  if (next.kind === "quote") {
    // 이미 별도 협의 규모면 다시 묻지 않는다(그 규모는 고객센터와 따로 정한다).
    if (cur.kind === "quote") return none;
    return { ...none, preview: { needsConsent: true, quote: true, token: "quote", projected: nextCount } };
  }
  // 기준 구간 = 동의한 구간. 동의한 적이 없으면 지금 구간(0명이면 첫 구간 — 첫 구간 요금은 가입 때 요금표로 안내된 기본 요금).
  const baseline = c.approvedTierIndex ?? (cur.kind === "tier" ? cur.tierIndex : 0);
  if (next.tierIndex <= baseline) return none;
  const fromLabel = tierLabel(baseline);
  if (fromLabel === null) return none; // 도달 불가(방어 — 표 밖 번호)
  const fromTotal = withVat(PRICE_TIERS[baseline].monthly).total;
  return {
    preview: {
      needsConsent: true, quote: false, token: String(next.tierIndex), projected: nextCount,
      fromLabel, fromTotal, toLabel: next.label, toTotal: next.total,
    },
    toTierIndex: next.tierIndex, toTotal: next.total, fromLabel, fromTotal,
  };
}

/** 화면용 — 이 변경에 동의가 필요한지 미리 본다(아무것도 저장하지 않는다). */
export async function previewSeatConsent(companyId: string, delta: SeatDelta): Promise<SeatPreview> {
  return (await plan(companyId, delta)).preview;
}

/**
 * 서버 액션용 관문. 동의가 필요 없거나, 화면이 보낸 동의 값이 지금 계산과 같으면 ok.
 *  · ok일 때 commit()을 **실제 등록이 성공한 뒤** 부른다 — 동의 구간 올리기·자동결제 카드 동의 근거 갱신·관리자 기록.
 *  · 동의 값이 다르면(그사이 다른 관리자가 직원을 늘려 금액이 바뀜) 진행하지 않고 새 금액을 돌려준다.
 */
export async function checkSeatConsent(
  me: Actor,
  delta: SeatDelta,
  consentValue: FormDataEntryValue | null
): Promise<{ ok: true; commit: () => Promise<void> } | { ok: false; preview: SeatPreview }> {
  const p = await plan(me.companyId, delta);
  if (!p.preview.needsConsent) return { ok: true, commit: async () => {} };
  if (typeof consentValue !== "string" || consentValue !== p.preview.token) return { ok: false, preview: p.preview };
  const preview = p.preview;
  return {
    ok: true,
    commit: async () => {
      try {
        if (!preview.quote && p.toTierIndex !== null && p.toTotal !== null) {
          const to = p.toTierIndex;
          const now = new Date();
          // 동의 구간은 **올리기만** 한다(다른 관리자가 그사이 더 높게 동의했으면 그대로).
          await prisma.company.updateMany({
            where: { id: me.companyId, OR: [{ approvedTierIndex: null }, { approvedTierIndex: { lt: to } }] },
            data: { approvedTierIndex: to },
          });
          // 자동결제 카드가 있으면 동의 근거도 새 금액으로 — 3단계의 "동의 금액보다 많으면 멈춤"을 통과하게.
          await prisma.pgBillingKey.updateMany({
            where: {
              companyId: me.companyId, status: { in: ["active", "paused"] },
              OR: [{ consentTierIndex: null }, { consentTierIndex: { lt: to } }],
            },
            data: { consentTierIndex: to, consentTotal: p.toTotal, consentedAt: now },
          });
        }
        // 동의 증거 — 누가·언제·얼마→얼마(관리자 기록, 2년 보관). 금액은 부가세 포함 카드 청구액.
        const what = preview.quote
          ? `price_consent:별도 협의 규모(${preview.projected}명)`
          : `price_consent:${p.fromLabel} 월 ${p.fromTotal?.toLocaleString("ko-KR")}원 → ${preview.toLabel} 월 ${preview.toTotal.toLocaleString("ko-KR")}원(${preview.projected}명)`;
        await logAdminAction(me, "config", what);
      } catch (e) {
        // 등록은 이미 끝났다 — 동의 저장 실패로 등록을 되돌리지 않는다. 자동결제는 동의 금액까지만 청구하므로 고객 쪽 손해는 없다.
        console.error("[seat-consent] [운영자 확인 필요] 인원 증가 동의 저장 실패:", e instanceof Error ? e.name : "unknown");
      }
    },
  };
}
