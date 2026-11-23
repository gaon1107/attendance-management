"use server";
// [운영자 전용] 회원사 설정 변경 — 무료 이용 마지막 날 지정 · 시험용 회사 표시 (2026-11-18, 운영 준비 3단계)
//
// 🔴 모든 액션은 **맨 처음에 운영자 세션을 다시 확인**한다(화면에서 버튼을 숨기는 것은 방어가 아니다).
// 🔴 바꿀 때마다 운영자 기록(AccessEvent)을 남긴다 — 누가·언제·어느 회사의·무엇을(이전→이후).
//    기록은 companyId=null + actorName "운영자 이름"으로 남긴다(app/actions/operator.ts의 로그인 기록과 같은 방식).
//    고객사의 [보안]-[접속기록]에는 섞이지 않고, 운영자 화면 [운영자 접속 기록]에서만 본다.
// ⚠️ 2026-11-23 결제 5단계부터 **무료 마지막 날·시험용 표시는 미납 차단에 바로 영향을 준다**(lib/service-access.ts —
//    결제 개시일 설정이 켜진 뒤). 무료 기간을 과거로 당기거나 기본값으로 되돌리면 그 회사 직원 출근이 곧 막힐 수 있어,
//    바꾼 뒤 막는 날을 결과 문구에 함께 알린다. 비상 해제 = 무료 마지막 날을 늘려 주기.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentOperator } from "@/lib/operator-session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { companyNameMatches } from "@/lib/company-name";
import { restoreBlockedReason } from "@/lib/company-termination";
import { markCompanyCardsForDeletion, rescheduleCompanyCards } from "@/lib/billing-auto";
import { getServiceAccess } from "@/lib/service-access";

export type OperatorActionResult = { ok: boolean; message: string } | null;

const MAX_YEARS_AHEAD = 3; // 오타(예: 2207년) 방지용 상한

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → 그 날 0시(서버 TZ=Asia/Seoul). 달력에 없는 날짜(2월 30일 등)면 null. */
function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

async function logOperatorChange(me: { name: string; email: string }, meta: string): Promise<void> {
  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: null,
    userId: null,
    actorName: `운영자 ${me.name}`,
    emailTried: me.email,
    kind: "config",
    result: "success",
    ip,
    userAgent,
    meta,
  });
}

/**
 * 무료 이용 마지막 날 지정/되돌리기.
 *  · mode=set   : trialLastDate = 고른 날짜(그 날까지 무료)
 *  · mode=reset : null(기본값 = 가입일부터 30일로 되돌림)
 */
export async function setCompanyTrial(_prev: OperatorActionResult, formData: FormData): Promise<OperatorActionResult> {
  const me = await getCurrentOperator();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };

  const companyId = String(formData.get("companyId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!companyId || (mode !== "set" && mode !== "reset")) return { ok: false, message: "요청이 올바르지 않습니다." };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, createdAt: true, trialLastDate: true },
  });
  if (!company) return { ok: false, message: "회사를 찾을 수 없습니다." };

  let next: Date | null = null;
  if (mode === "set") {
    next = parseYmd(String(formData.get("trialLastDate") ?? "").trim());
    if (!next) return { ok: false, message: "날짜를 골라 주세요." };
    const signupDay = new Date(company.createdAt);
    signupDay.setHours(0, 0, 0, 0);
    if (next < signupDay) return { ok: false, message: "가입일보다 앞선 날짜는 정할 수 없습니다." };
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() + MAX_YEARS_AHEAD);
    if (next > limit) return { ok: false, message: `${MAX_YEARS_AHEAD}년보다 먼 날짜는 정할 수 없습니다. 날짜를 확인해 주세요.` };
  }

  const before = company.trialLastDate ? ymd(company.trialLastDate) : "기본";
  const after = next ? ymd(next) : "기본";
  if (before === after) return { ok: true, message: "바뀐 내용이 없습니다." };

  // 읽은 값 그대로일 때만 바꾼다 — 운영자 두 명이 동시에 바꾸면 기록의 "이전 값"이 실제와 어긋나므로(3단계 검수 경미 5)
  const changed = await prisma.company.updateMany({
    where: { id: company.id, trialLastDate: company.trialLastDate },
    data: { trialLastDate: next },
  });
  if (changed.count === 0) return { ok: false, message: "그사이 다른 사람이 값을 바꿨습니다. 화면을 새로 고친 뒤 다시 해 주세요." };
  await logOperatorChange(me, `operator_trial_set:${company.name} (${before}→${after})`);
  // 자동결제 카드의 다음 결제일을 새 무료 기간에 맞춘다(2026-11-23 결제 3단계 검수 중간 6) — 무료 기간을 줄였는데 옛 결제일을
  //  기다리면 그사이 이용 기간이 빈다. 실패해도 무료 기간 변경은 이미 끝났으므로 기록만 남긴다(정기 청구가 늦게라도 바로잡지 못하는 경우만 운영자 확인).
  try {
    await rescheduleCompanyCards(company.id);
  } catch (e) {
    console.error(`[operator] [운영자 확인 필요] 자동결제 결제일 다시 계산 실패(ID ${company.id.slice(0, 8)}):`, e instanceof Error ? e.name : "unknown");
  }

  // 미납 차단이 켜져 있으면 바꾼 결과로 언제 막히는지 함께 알린다(검수 중간 3 — 실수로 당기면 경고 없이 막혔다).
  let warn = "";
  try {
    const a = await getServiceAccess(company.id);
    if (a?.kind === "blocked") warn = " ⚠️ 이 회사는 지금 직원의 새 출근이 막힌 상태가 됩니다.";
    else if (a?.kind === "grace" && a.hold) {
      // 막는 날이 지났지만 보류 중 — 지난 날짜를 "부터 막힙니다"로 보이지 않게(재확인 경미 2)
      warn = a.hold === "payment_pending" ? " ⚠️ 막을 날이 지났지만 확인 중인 결제가 있어 보류 중입니다."
        : a.hold === "nothing_to_pay" ? " ⚠️ 막을 날이 지났지만 요금 대상 인원이 없어 보류 중입니다."
        : " ⚠️ 막을 날이 지났지만 카드로 결제할 수 없는 규모라 보류 중입니다(따로 안내 필요).";
    } else if ((a?.kind === "grace" || a?.kind === "ending") && a.blockAt) warn = ` ⚠️ 결제가 없으면 ${ymd(a.blockAt)}부터 직원의 새 출근이 막힙니다.`;
  } catch {
    warn = "";
  }

  revalidatePath("/operator");
  revalidatePath(`/operator/companies/${company.id}`);
  return {
    ok: true,
    message: (next ? `무료 이용 마지막 날을 ${after}로 정했습니다.` : "무료 이용 기간을 기본값(가입일부터 30일)으로 되돌렸습니다.") + warn,
  };
}

/** 시험용 회사 표시 켜기/끄기 — 홈화면 공개 통계·운영자 고객 수에서 빠진다(근태 기능에는 영향 없음). */
export async function setCompanyDemo(_prev: OperatorActionResult, formData: FormData): Promise<OperatorActionResult> {
  const me = await getCurrentOperator();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };

  const companyId = String(formData.get("companyId") ?? "");
  const on = String(formData.get("on") ?? "");
  if (!companyId || (on !== "1" && on !== "0")) return { ok: false, message: "요청이 올바르지 않습니다." };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, isDemo: true } });
  if (!company) return { ok: false, message: "회사를 찾을 수 없습니다." };
  const next = on === "1";
  if (company.isDemo === next) return { ok: true, message: "바뀐 내용이 없습니다." };

  const changed = await prisma.company.updateMany({ where: { id: company.id, isDemo: company.isDemo }, data: { isDemo: next } });
  if (changed.count === 0) return { ok: false, message: "그사이 다른 사람이 값을 바꿨습니다. 화면을 새로 고친 뒤 다시 해 주세요." };
  // 끝 괄호(ID)는 "가온(주)"처럼 괄호로 끝나는 회사명이 기록 화면에서 잘리지 않게 붙인다(3단계 검수 경미 1)
  await logOperatorChange(me, `${next ? "operator_demo_on" : "operator_demo_off"}:${company.name} (ID ${company.id.slice(0, 8)})`);

  revalidatePath("/operator");
  revalidatePath(`/operator/companies/${company.id}`);
  return { ok: true, message: next ? "시험용 회사로 표시했습니다." : "시험용 표시를 해제했습니다." };
}

// ═══════════════════════════════════════════════════════════════════════════
// 해지(탈퇴) 처리 — 2026-11-22, 이용약관 제14조 ④·제15조
//
// 🔴 **데이터를 지우지 않는다.** Company.terminatedAt만 찍는다. 그 순간부터 그 회사 사람 전원이
//    로그인할 수 없고(lib/session.ts·app/actions/auth.ts) PC 프로그램도 막힌다(lib/agent-auth.ts).
//    약관이 정한 30일 유예 동안 언제든 **되살리기**로 원래대로 돌아간다.
//    30일이 지나면 새벽 자동 파기가 지운다(2단계, lib/company-purge.ts). 그때부터는 되살릴 수 없다(lib/company-termination.ts).
//
// 🔴 오조작 방지: 해지하려면 **회사 이름을 그대로 다시 입력**해야 한다. 버튼 하나로 고객사 전원이
//    즉시 로그인 불가가 되기 때문이다(출퇴근을 못 찍으면 그날 근로시간 기록이 빈다).
// ═══════════════════════════════════════════════════════════════════════════

/** 해지 처리 — 확인 문구(회사 이름)가 정확히 일치할 때만 실행한다. */
export async function terminateCompany(_prev: OperatorActionResult, formData: FormData): Promise<OperatorActionResult> {
  const me = await getCurrentOperator();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };

  const companyId = String(formData.get("companyId") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 200);
  // 🔴 자료 전달 확인(2026-11-22 사장님 결정) — 화면 체크박스만 믿지 않는다(화면 검사는 방어가 아니다).
  //    해지하면 고객사는 로그인할 수 없어 **스스로 근태 자료를 받을 수 없다**. 약관 제14조 ③④가
    //  "해지 전에 받거나 고객지원이 전달한다"로 되어 있으므로, 그 절차를 마쳤다는 확인 없이는 해지하지 않는다.
  const handover = String(formData.get("handover") ?? "") === "on";
  if (!companyId) return { ok: false, message: "요청이 올바르지 않습니다." };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, terminatedAt: true } });
  if (!company) return { ok: false, message: "회사를 찾을 수 없습니다." };
  if (company.terminatedAt) {
    // 다른 창에서 이미 해지된 경우 — 화면을 실제 상태로 다시 그린다(검수 중간 3).
    //  성공 메시지는 화면에 보이지 않으므로(FailMsg), 갱신이 없으면 눌러도 아무 일도 없는 것처럼 보인다.
    revalidatePath(`/operator/companies/${company.id}`);
    return { ok: true, message: "이미 해지된 회사입니다." };
  }
  // 이름 확인 — 사람이 보기에 같은 글자면 통과시킨다. 판정 규칙은 lib/company-name.ts 한 곳에만 둔다.
  //  🔴 **화면도 같은 함수를 쓴다**(CompanyControls.tsx) — 기준이 어긋나면 "버튼은 켜지는데 서버가 거부"
  //     또는 그 반대가 된다(2026-11-22 재검수 중간 A).
  //  ⚠️ 이 검사를 직접 쓰지 말 것 — 예전에 여기 정규식을 손으로 쓰다 `\s`를 `s`로 잘못 적어 **공백 대신
  //     영문자 s를 지우는** 코드가 됐다(재검수 치명 1). tsc도 eslint도 잡지 못한다.
  if (!handover) {
    return { ok: false, message: "자료 전달 확인에 체크해 주세요. 해지하면 고객사는 스스로 근태 자료를 받을 수 없습니다." };
  }
  if (!companyNameMatches(confirmName, company.name)) {
    return { ok: false, message: "회사 이름이 일치하지 않습니다. 화면에 보이는 이름을 그대로 입력해 주세요." };
  }

  // 조건부 갱신 — 그사이 다른 운영자가 이미 해지했으면 덮어쓰지 않는다.
  const changed = await prisma.company.updateMany({
    where: { id: company.id, terminatedAt: null },
    data: { terminatedAt: new Date(), terminatedBy: me.name, terminatedNote: note || null },
  });
  if (changed.count === 0) {
    revalidatePath(`/operator/companies/${company.id}`); // 어긋난 화면을 실제 상태로 되돌린다(검수 중간 3)
    return { ok: false, message: "그사이 다른 사람이 처리했습니다. 다시 확인해 주세요." };
  }

  await logOperatorChange(me, `operator_terminate:${company.name} (ID ${company.id.slice(0, 8)})`);

  // 자동결제 카드 내려놓기(2026-11-23 결제 3단계) — 이 순간부터 청구하지 않고, KIS 카드 지우기는 뒤에서(실패하면 10분 정리가 재시도).
  //  · 해지 처리 자체는 이미 끝났다 → 여기서 실패해도 해지를 되돌리지 않는다. 남은 카드는 파기 엔진이 "카드 지우기 대기"로 막고,
  //    정기 청구는 해지 회사에 결제하지 않으며(lib/billing-auto.ts), 결제가 들어와도 반영 단계가 해지 회사면 취소한다.
  //  · ⚠️ 되살리기(restoreCompany)는 카드를 되살리지 않는다 — 고객이 [구독·요금]에서 다시 신청한다.
  try {
    await markCompanyCardsForDeletion(company.id, "회사 해지로 자동결제 카드 지움");
  } catch (e) {
    console.error(`[operator] [운영자 확인 필요] 해지 회사 자동결제 카드 내려놓기 실패(ID ${company.id.slice(0, 8)}):`, e instanceof Error ? e.name : "unknown");
  }

  revalidatePath("/operator");
  revalidatePath(`/operator/companies/${company.id}`);
  return {
    ok: true,
    message: "해지 처리했습니다. 이 회사의 모든 계정이 로그인할 수 없습니다. 데이터는 그대로 있으며 30일 안에는 되살릴 수 있습니다.",
  };
}

/** 되살리기 — terminatedAt을 지우는 것뿐이다(다른 칸은 건드리지 않는다). */
export async function restoreCompany(_prev: OperatorActionResult, formData: FormData): Promise<OperatorActionResult> {
  const me = await getCurrentOperator();
  if (!me) return { ok: false, message: "로그인이 풀렸습니다. 다시 로그인해 주세요." };

  const companyId = String(formData.get("companyId") ?? "");
  if (!companyId) return { ok: false, message: "요청이 올바르지 않습니다." };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, terminatedAt: true, purgeStartedAt: true },
  });
  if (!company) return { ok: false, message: "회사를 찾을 수 없습니다." };
  if (!company.terminatedAt) {
    revalidatePath(`/operator/companies/${company.id}`); // 위와 같은 이유(검수 중간 3)
    return { ok: true, message: "해지되지 않은 회사입니다." };
  }
  // 🔴 해지 2단계(2026-11-22): 30일 보관이 끝났거나 자동 파기가 시작된 회사는 되살리지 않는다.
  //    판정은 화면과 같은 함수(lib/company-termination.ts) — 화면 버튼을 숨기는 것만으로는 방어가 아니다.
  const now = new Date();
  const blocked = restoreBlockedReason(company, now);
  if (blocked) {
    revalidatePath(`/operator/companies/${company.id}`);
    return { ok: false, message: blocked };
  }

  // 🔴 terminatedBy·terminatedNote는 **지우지 않는다**(검수 중간 2). 지우면 "왜·누가 해지했는지"가
  //    제품 안 어디에도 사람이 읽을 수 있는 형태로 남지 않는다. 해지 상태가 아니면 화면에 보이지 않고,
  //    다시 해지하면 새 값으로 덮인다 — 남겨 두는 쪽이 득이다.
  // 🔴 조건에 "파기 시작 안 됨 + 읽은 해지 시각 그대로"를 함께 건다 — 위 검사와 이 갱신 사이에 파기가 시작되면
  //    (새벽 자동 파기가 먼저 purgeStartedAt을 찍으면) 여기서 0건이 되어 되살리지 않는다.
  const changed = await prisma.company.updateMany({
    where: { id: company.id, terminatedAt: company.terminatedAt, purgeStartedAt: null },
    data: { terminatedAt: null },
  });
  if (changed.count === 0) {
    revalidatePath(`/operator/companies/${company.id}`); // 어긋난 화면을 실제 상태로 되돌린다(검수 중간 3)
    return { ok: false, message: "그사이 다른 사람이 처리했습니다. 다시 확인해 주세요." };
  }

  await logOperatorChange(me, `operator_restore:${company.name} (ID ${company.id.slice(0, 8)})`);

  revalidatePath("/operator");
  revalidatePath(`/operator/companies/${company.id}`);
  return { ok: true, message: "되살렸습니다. 이 회사의 계정이 다시 로그인할 수 있습니다." };
}
