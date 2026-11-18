"use server";
// [운영자 전용] 회원사 설정 변경 — 무료 이용 마지막 날 지정 · 시험용 회사 표시 (2026-11-18, 운영 준비 3단계)
//
// 🔴 모든 액션은 **맨 처음에 운영자 세션을 다시 확인**한다(화면에서 버튼을 숨기는 것은 방어가 아니다).
// 🔴 바꿀 때마다 운영자 기록(AccessEvent)을 남긴다 — 누가·언제·어느 회사의·무엇을(이전→이후).
//    기록은 companyId=null + actorName "운영자 이름"으로 남긴다(app/actions/operator.ts의 로그인 기록과 같은 방식).
//    고객사의 [보안]-[접속기록]에는 섞이지 않고, 운영자 화면 [운영자 접속 기록]에서만 본다.
// ⚠️ 값만 바꾸고 아무것도 막지 않는다(만료 차단은 결제 화면과 한 세트 — lib/trial.ts 머리말).
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentOperator } from "@/lib/operator-session";
import { recordAccess, readClientMeta } from "@/lib/access-log";

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

  await prisma.company.update({ where: { id: company.id }, data: { trialLastDate: next } });
  await logOperatorChange(me, `operator_trial_set:${company.name} (${before}→${after})`);

  revalidatePath("/operator");
  revalidatePath(`/operator/companies/${company.id}`);
  return {
    ok: true,
    message: next ? `무료 이용 마지막 날을 ${after}로 정했습니다.` : "무료 이용 기간을 기본값(가입일부터 30일)으로 되돌렸습니다.",
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

  await prisma.company.update({ where: { id: company.id }, data: { isDemo: next } });
  await logOperatorChange(me, `${next ? "operator_demo_on" : "operator_demo_off"}:${company.name}`);

  revalidatePath("/operator");
  revalidatePath(`/operator/companies/${company.id}`);
  return { ok: true, message: next ? "시험용 회사로 표시했습니다." : "시험용 표시를 해제했습니다." };
}
