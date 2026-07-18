"use server";
// 문자(아이원24) 발송 액션 — 초대·임시비밀번호(A-2). 관리자 전용·회사격리.
//  · 버튼 수동 발송 + 1회 제한(같은 초대/요청 중복발송 차단). 1회 제한은 SmsLog 유니크로 원자 보장.
//  · 문자는 부가기능 — 실패해도 초대 생성·임시비번 발급 본기능에는 영향 없음(별도 액션).
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/session";
import { sendSms, normalizePhone } from "@/lib/sms";
import { revalidatePath } from "next/cache";

type ActionResult = { error?: string; ok?: boolean };

// 원자적 1회 제한 + 발송 + 결과확정.
//  ① (companyId,kind,refId) 유니크로 먼저 "pending" 선점 → 동시 클릭 시 두 번째는 P2002로 즉시 차단(발송 전).
//  ② 성공 → result="success"로 확정(이후 재발송 영구 차단).
//  ③ 실패 → 과금 없음이므로 refId를 null로 바꿔 슬롯을 풀어 재시도 허용(실패 기록은 감사용으로 남김).
async function claimSendFinalize(input: {
  companyId: string;
  userId: string | null;
  kind: "invite" | "temp_password";
  refId: string;
  to: string;
  text: string;
}): Promise<ActionResult> {
  let logId: string;
  try {
    const log = await prisma.smsLog.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        kind: input.kind,
        refId: input.refId,
        toNumber: input.to,
        result: "pending",
      },
      select: { id: true },
    });
    logId = log.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "이미 문자를 보냈거나 보내는 중입니다.(중복 발송 방지)" };
    }
    throw e;
  }

  const res = await sendSms({ to: input.to, text: input.text });

  if (res.ok) {
    await prisma.smsLog.update({ where: { id: logId }, data: { result: "success", detail: null } });
    return { ok: true };
  }
  // 실패: 과금 안 됨 → refId를 풀어 재시도 허용(실패 기록은 남김).
  await prisma.smsLog.update({
    where: { id: logId },
    data: { result: "fail", refId: null, detail: res.detail.slice(0, 200) },
  });
  return { error: `문자 발송 실패: ${res.detail}` };
}

// 관리자: 초대 링크를 문자로 발송. url은 클라이언트가 만든 전체 초대 URL(토큰 일치를 서버가 검증).
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
  // URL 위·변조 방지: 반드시 이 초대의 토큰 경로를 담고 있어야 한다(다른 링크로 치환 차단).
  if (!url.includes(`/invite/${invite.token}`)) return { error: "초대 링크가 올바르지 않습니다." };

  const text = `[${me.company.name}] 근태관리 초대입니다. ${url} (7일 이내 가입해 주세요)`;
  const result = await claimSendFinalize({ companyId: me.companyId, userId: null, kind: "invite", refId: inviteId, to, text });

  revalidatePath("/employees");
  return result;
}

// 관리자: 임시 비밀번호를 대상 직원 전화번호로 발송. temp는 방금 발급돼 화면에 표시된 값.
export async function sendTempPasswordSms(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const requestId = String(formData.get("requestId") ?? "");
  const temp = String(formData.get("temp") ?? "");
  if (!temp) return { error: "임시 비밀번호가 없습니다." };

  // 회사 격리 + 대상 직원(전화번호는 직원 프로필에서 서버가 조회 — 클라이언트가 못 바꿈)
  const req = await prisma.passwordResetRequest.findFirst({
    where: { id: requestId, companyId: me.companyId },
    include: { user: true },
  });
  if (!req) return { error: "요청을 찾을 수 없습니다." };

  const to = normalizePhone(req.user.phone ?? "");
  if (to.length < 9 || to.length > 12) {
    return { error: "직원 전화번호가 없습니다. 직원 상세에서 전화번호를 먼저 입력해 주세요." };
  }

  const text = `[${me.company.name}] 임시 비밀번호: ${temp} — 로그인 후 새 비밀번호로 변경해 주세요.`;
  const result = await claimSendFinalize({ companyId: me.companyId, userId: req.userId, kind: "temp_password", refId: requestId, to, text });

  revalidatePath("/employees");
  return result;
}
