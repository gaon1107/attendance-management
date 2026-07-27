"use server";
// 비밀번호 재설정 — 관리자 발급식.
// ① 직원이 로그인 화면 "비밀번호 찾기"로 요청을 접수한다(requestPasswordReset, 로그인 불필요).
// ② 관리자가 대기 요청을 확인하고 임시 비밀번호를 발급한다(issueTempPassword, 관리자 전용).
// ※ 지금은 관리자가 임시 비밀번호를 직접 직원에게 전달한다. 자동 메일 발송·문자 인증은 2차.
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { generateTempPassword } from "@/lib/temp-password";
import { getCurrentUser } from "@/lib/session";
import { canManageAccount } from "@/lib/owner-rules";
import { revalidatePath } from "next/cache";

// ① 직원이 비밀번호 재설정을 요청한다(로그인 화면에서). 이메일만 받는다.
// 보안: 이메일이 실제로 있는지 여부를 응답으로 알려주지 않는다(있든 없든 같은 메시지).
//       실제로 있는 계정에 대해서만 대기 요청을 만든다. 이미 대기 중이면 중복 생성하지 않는다.
export async function requestPasswordReset(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "이메일을 입력해주세요." };

  const user = await prisma.user.findUnique({ where: { email } });

  // 실제 계정이고, 퇴사(비활성화)된 계정이 아닐 때만 요청을 만든다.
  //  · 🔒 회사 계정은 제외한다: 이 요청은 **관리자가 승인해 임시 비번을 발급**하는 구조라,
  //    회사 계정 요청을 만들어 두면 관리자가 직원 요청인 줄 알고 승인해 **회사 열쇠를 넘겨줄 수 있다**
  //    (검수 치명 1). 회사 계정 비밀번호는 회사 계정으로 직접 로그인해서만 바꾼다.
  //  · 응답은 있든 없든 동일하므로 "회사 계정이라 거부됐다"는 사실도 밖으로 새지 않는다.
  if (user && !user.deactivatedAt && !user.isOwner) {
    const existing = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.id, status: "pending" },
    });
    if (!existing) {
      await prisma.passwordResetRequest.create({
        data: { companyId: user.companyId, userId: user.id },
      });
    }
  }

  // 성공 여부와 무관하게 항상 같은 안내(이메일 존재 여부 노출 방지).
  return { ok: true };
}

// ② 관리자가 대기 요청을 처리 — 임시 비밀번호를 생성해 그 직원 계정에 적용한다.
//    반환값의 tempPassword를 관리자가 직원에게 전달한다. 직원은 이 임시비번으로 로그인하면
//    곧바로 "새 비밀번호 설정" 화면으로 강제 이동한다(mustChangePassword).
export async function issueTempPassword(
  requestId: string
): Promise<{ error?: string; ok?: boolean; tempPassword?: string; name?: string }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  // 회사 격리: 내 회사의 대기 요청만 처리할 수 있다.
  const req = await prisma.passwordResetRequest.findFirst({
    where: { id: requestId, companyId: me.companyId, status: "pending" },
    include: { user: true },
  });
  if (!req) return { error: "이미 처리되었거나 없는 요청입니다." };
  if (req.user.deactivatedAt) return { error: "퇴사한 직원의 요청입니다." };
  // 🔒 회사 계정에는 임시 비번을 발급하지 않는다(회사 열쇠 탈취 경로 — 검수 치명 1).
  //    위 requestPasswordReset이 이미 막지만, 옛 요청이 남아 있을 수 있어 여기서도 검사한다.
  {
    const g = canManageAccount(me, req.user);
    if (!g.ok) return { error: g.reason };
  }

  const tempPassword = generateTempPassword();

  // 임시 비밀번호 적용 + "비번 변경 필요" 표시 + 실패/잠금 초기화. 기존 로그인 세션은 무효화.
  await prisma.user.update({
    where: { id: req.userId },
    data: {
      passwordHash: hashPassword(tempPassword),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await prisma.session.deleteMany({ where: { userId: req.userId } });

  // 요청을 처리 완료로 표시.
  await prisma.passwordResetRequest.update({
    where: { id: req.id },
    data: { status: "resolved", resolvedAt: new Date() },
  });

  revalidatePath("/employees");
  revalidatePath("/dashboard");
  return { ok: true, tempPassword, name: req.user.name };
}
