"use server";
// 직원 초대 — 관리자가 초대 링크를 만들고(createInvite), 직원이 그 링크로 스스로 가입한다(acceptInvite).
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { getCurrentUser, createSession } from "@/lib/session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { parseProfile, employeeNoTaken } from "@/lib/employee-profile";
import { randomBytes } from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// 관리자: 초대 링크 생성. 7일간 유효한 1회용 토큰을 만든다.
export async function createInvite(): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const token = randomBytes(24).toString("hex");
  await prisma.invite.create({
    data: {
      companyId: me.companyId,
      token,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    },
  });
  revalidatePath("/employees");
}

// 관리자: 아직 안 쓴 초대 링크 취소(삭제).
export async function cancelInvite(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  // 회사 격리 — 내 회사 초대만 취소 가능
  const inv = await prisma.invite.findFirst({ where: { id, companyId: me.companyId } });
  if (!inv) return;
  await prisma.invite.delete({ where: { id: inv.id } });
  revalidatePath("/employees");
}

// 직원(비로그인): 초대 링크로 본인 계정 생성. 이름·이메일·비밀번호를 직접 정한다.
export async function acceptInvite(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !email || !password) return { error: "모든 항목을 입력해주세요." };
  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };

  // 초대 유효성 검증(존재·미사용·미만료)
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    return { error: "유효하지 않거나 만료된 초대입니다. 관리자에게 새 링크를 요청해주세요." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "이미 가입된 이메일입니다. 다른 이메일을 쓰거나 로그인해주세요." };

  // 인적정보(선택) — 직원이 채운 것만 저장(빈 항목은 null). 관리자가 나중에 상세에서 고칠 수 있다.
  const parsed = parseProfile(formData);
  if (!parsed.ok) return { error: parsed.error };
  const profile = parsed.profile;
  // 사번 중복검사 — 초대한 회사에 같은 사번을 쓰는 활성 직원이 이미 있으면 가입 거부(email 검사와 같은 방식).
  if (await employeeNoTaken(invite.companyId, profile.employeeNo)) {
    return { error: "이미 같은 사번을 쓰는 직원이 있습니다. 관리자에게 확인해 주세요." };
  }

  const user = await prisma.user.create({
    data: {
      companyId: invite.companyId, // 초대한 회사 소속으로
      email,
      name,
      passwordHash: hashPassword(password),
      role: "employee",
      phone: profile.phone,
      position: profile.position,
      employeeNo: profile.employeeNo,
      hireDate: profile.hireDate,
    },
  });

  // 초대 1회용 처리
  await prisma.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });

  await createSession(user.id);
  // 접속기록: 초대 가입 직후 자동 로그인 1건(성공).
  {
    const { ip, userAgent } = readClientMeta(await headers());
    await recordAccess({ companyId: user.companyId, userId: user.id, actorName: user.name, emailTried: email, kind: "login", result: "success", ip, userAgent });
  }
  redirect("/auth-method"); // 가입 직후 출퇴근 인증방식 선택 화면으로
}
