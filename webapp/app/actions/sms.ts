"use server";
// 문자(아이원24) 발송 액션 — 초대·임시비밀번호(A-2). 관리자 전용·회사격리.
//  · 버튼 수동 발송 + 1회 제한(같은 초대/요청 중복발송 차단, 서버에서 강제).
//  · 문자는 부가기능 — 실패해도 초대 생성·임시비번 발급 본기능에는 영향 없음(별도 액션).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { sendSms, normalizePhone } from "@/lib/sms";
import { revalidatePath } from "next/cache";

type ActionResult = { error?: string; ok?: boolean };

// 1회 제한: 이 (회사, 종류, refId)로 이미 성공한 발송이 있으면 true.
async function alreadySentOk(companyId: string, kind: string, refId: string): Promise<boolean> {
  const hit = await prisma.smsLog.findFirst({
    where: { companyId, kind, refId, result: "success" },
    select: { id: true },
  });
  return !!hit;
}

// 관리자: 초대 링크를 문자로 발송. url은 클라이언트가 만든 전체 초대 URL.
export async function sendInviteSms(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const inviteId = String(formData.get("inviteId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const to = normalizePhone(String(formData.get("phone") ?? ""));

  if (!url) return { error: "초대 링크가 없습니다." };
  if (to.length < 9 || to.length > 12) return { error: "받는 사람 전화번호를 정확히 입력해주세요." };

  // 회사 격리 + 유효 초대 확인(미사용·미만료)
  const invite = await prisma.invite.findFirst({ where: { id: inviteId, companyId: me.companyId } });
  if (!invite) return { error: "초대를 찾을 수 없습니다." };
  if (invite.usedAt) return { error: "이미 가입에 사용된 초대입니다." };
  if (invite.expiresAt < new Date()) return { error: "만료된 초대입니다." };

  if (await alreadySentOk(me.companyId, "invite", inviteId)) {
    return { error: "이 초대는 이미 문자를 보냈습니다.(중복 발송 방지)" };
  }

  const text = `[${me.company.name}] 근태관리 초대입니다. ${url} (7일 이내 가입해 주세요)`;
  const res = await sendSms({ to, text });

  await prisma.smsLog.create({
    data: {
      companyId: me.companyId,
      userId: null,
      kind: "invite",
      refId: inviteId,
      toNumber: to,
      result: res.ok ? "success" : "fail",
      detail: res.ok ? null : res.detail.slice(0, 200),
    },
  });

  revalidatePath("/employees");
  if (!res.ok) return { error: `문자 발송 실패: ${res.detail}` };
  return { ok: true };
}

// 관리자: 임시 비밀번호를 대상 직원 전화번호로 발송. temp는 방금 발급돼 화면에 표시된 값.
export async function sendTempPasswordSms(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const requestId = String(formData.get("requestId") ?? "");
  const temp = String(formData.get("temp") ?? "");
  if (!temp) return { error: "임시 비밀번호가 없습니다." };

  // 회사 격리 + 대상 직원(전화번호는 직원 프로필에서)
  const req = await prisma.passwordResetRequest.findFirst({
    where: { id: requestId, companyId: me.companyId },
    include: { user: true },
  });
  if (!req) return { error: "요청을 찾을 수 없습니다." };

  const to = normalizePhone(req.user.phone ?? "");
  if (to.length < 9 || to.length > 12) {
    return { error: "직원 전화번호가 없습니다. 직원 상세에서 전화번호를 먼저 입력해 주세요." };
  }

  if (await alreadySentOk(me.companyId, "temp_password", requestId)) {
    return { error: "이 요청은 이미 문자를 보냈습니다.(중복 발송 방지)" };
  }

  const text = `[${me.company.name}] 임시 비밀번호: ${temp} — 로그인 후 새 비밀번호로 변경해 주세요.`;
  const res = await sendSms({ to, text });

  await prisma.smsLog.create({
    data: {
      companyId: me.companyId,
      userId: req.userId,
      kind: "temp_password",
      refId: requestId,
      toNumber: to,
      result: res.ok ? "success" : "fail",
      detail: res.ok ? null : res.detail.slice(0, 200), // 비밀번호 본문은 저장하지 않음
    },
  });

  revalidatePath("/employees");
  if (!res.ok) return { error: `문자 발송 실패: ${res.detail}` };
  return { ok: true };
}
