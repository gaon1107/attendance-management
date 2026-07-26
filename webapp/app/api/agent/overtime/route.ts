// [PC 에이전트] 잠금화면에서 바로 연장근무 신청 — PC가 잠긴 상태라 브라우저를 열 수 없기 때문에 필요하다.
//
// ⚠️ 왜 기존 requestOvertime(app/actions/overtime.ts)을 부르지 않나:
//    그 함수는 getCurrentUser()(브라우저 쿠키 세션)에 묶여 있어 설치형 앱에서는 쓸 수 없다.
//    그렇다고 그 함수를 고치면 기존 화면 6종·결재함까지 영향이 가므로(사규 2조), **건드리지 않고**
//    여기서 **같은 lib 함수(parseYmd·isValidHm·createApprovalStepsIfNeeded)로 같은 규칙을 조립**한다.
//    → 검증 규칙(500자 사유·start==end 금지·익일 허용)과 결재선 생성이 브라우저 신청과 100% 동일하다.
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseYmd } from "@/lib/leave";
import { isValidHm } from "@/lib/overtime-request";
import { createApprovalStepsIfNeeded } from "@/lib/approval-server";
import { authenticateAgent } from "@/lib/agent-auth";

export async function POST(req: Request) {
  const res = await authenticateAgent(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { auth } = res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // ── 아래 검증은 기존 requestOvertime과 같은 규칙·같은 함수 ──────────────────
  const targetDateRaw = String(b.targetDate ?? "");
  const date = parseYmd(targetDateRaw);
  if (!date) return NextResponse.json({ error: "날짜를 올바르게 선택해주세요." }, { status: 400 });
  // [에이전트 전용 추가 방어] 존재하지 않는 날짜(예: 2026-13-45)를 막는다.
  //  · 브라우저 화면은 날짜선택기(DatePicker)로 고르므로 이런 값이 올 수 없지만,
  //    설치형 앱은 JSON을 그대로 보내므로 여기서 확인한다. parseYmd는 넘침(13월 → 이듬해)을 그대로 통과시킨다.
  //  · ⚠️ 기존 parseYmd·브라우저 신청 로직은 건드리지 않는다(영향 범위 확대 방지) — 이 라우트 안에서만 확인.
  if (toYmd(date) !== targetDateRaw) {
    return NextResponse.json({ error: "날짜를 올바르게 선택해주세요." }, { status: 400 });
  }

  const startTime = String(b.startTime ?? "");
  const endTime = String(b.endTime ?? "");
  if (!isValidHm(startTime) || !isValidHm(endTime)) {
    return NextResponse.json({ error: "시작·종료 시각을 올바르게 입력해주세요." }, { status: 400 });
  }
  // 야근은 자정을 넘길 수 있어 end<=start를 허용(익일). 단, 완전히 같은 값은 0시간이라 막는다.
  if (startTime === endTime) {
    return NextResponse.json({ error: "시작 시각과 종료 시각이 같습니다." }, { status: 400 });
  }

  const reasonRaw = String(b.reason ?? "").trim();
  const reason = reasonRaw ? Array.from(reasonRaw).slice(0, 500).join("") : null;
  // ──────────────────────────────────────────────────────────────────────

  // [에이전트 전용 추가 안전장치] 잠금화면 버튼 연타·재전송으로 같은 신청이 여러 건 쌓이는 것을 막는다.
  //  · 브라우저 신청 로직은 건드리지 않는다(여기서만 확인). 이미 있으면 그 건을 그대로 돌려준다.
  const dup = await prisma.overtimeRequest.findFirst({
    where: { companyId: auth.user.companyId, userId: auth.user.id, targetDate: date, startTime, endTime, status: "pending" },
    select: { id: true, status: true },
  });
  if (dup) return NextResponse.json({ ok: true, id: dup.id, status: dup.status, duplicated: true });

  const company = await prisma.company.findUnique({
    where: { id: auth.user.companyId },
    select: { approvalMode: true, approvalStepCount: true },
  });

  const created = await prisma.overtimeRequest.create({
    data: { companyId: auth.user.companyId, userId: auth.user.id, targetDate: date, startTime, endTime, reason },
  });
  // 결재선을 켠 회사면 결재 단계를 생성(기존과 같은 함수 = 결재함·밀린결재 현황판에 그대로 뜬다).
  await createApprovalStepsIfNeeded(
    company, auth.user.companyId, auth.user.id, auth.user.departmentId, "overtime", created.id
  );

  // 결재자가 보는 화면들을 즉시 갱신(브라우저 신청과 동일한 경로).
  revalidatePath("/overtime");
  revalidatePath("/overtime/approvals");
  revalidatePath("/approvals");

  return NextResponse.json({ ok: true, id: created.id, status: "pending" });
}

// Date → "YYYY-MM-DD"(지역시간). 넘침 날짜인지 확인하는 되돌리기 비교용.
function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
