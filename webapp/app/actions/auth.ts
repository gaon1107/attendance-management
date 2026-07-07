"use server";
// 회원가입 / 로그인 / 로그아웃 서버 동작.
// 주의: 이 함수들은 화면 없이 직접 호출될 수도 있으므로, 입력값 검증을 항상 여기서 한다.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, destroySession } from "@/lib/session";
import { redirect } from "next/navigation";

// 회사 회원가입 — 회사 + 관리자 계정을 함께 만든다.
export async function signup(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const companyName = String(formData.get("companyName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!companyName || !name || !email || !password) {
    return { error: "모든 항목을 입력해주세요." };
  }
  if (password.length < 8) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "이미 가입된 이메일입니다." };
  }

  const company = await prisma.company.create({ data: { name: companyName } });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      email,
      name,
      passwordHash: hashPassword(password),
      role: "admin", // 회원가입한 사람은 관리자
    },
  });

  await createSession(user.id);
  // 가입 직후에는 회사 기본 설정(근무기준·위치)을 잡도록 온보딩으로 안내(건너뛰기 가능).
  redirect("/onboarding");
}

// 로그인 무차별 대입(비번 찍기) 방어 기준
const MAX_FAILED = 5; // 연속 5회 실패하면
const LOCK_MINUTES = 10; // 10분간 잠금

// 로그인 — 이메일/비밀번호 확인 후 세션 발급.
export async function login(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "이메일과 비밀번호를 입력해주세요." };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // 계정이 잠겨 있으면(연속 실패로 잠금) 비번이 맞아도 잠금 해제 시각까지 거부.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    return { error: `비밀번호를 여러 번 잘못 입력했습니다. 약 ${mins}분 뒤에 다시 시도해주세요.` };
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    // 실패 시: 실제 계정이면 실패 횟수를 올리고, 한도 도달하면 잠근다.
    if (user) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
            : { failedLoginCount: failed },
      });
    }
    // 보안: 이메일/비번 중 무엇이 틀렸는지 구분해 알려주지 않는다.
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // 성공 시: 실패 기록·잠금 초기화.
  if (user.failedLoginCount !== 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  await createSession(user.id);
  // 관리자는 대시보드로, 직원은 본인 출퇴근 화면으로
  redirect(user.role === "admin" ? "/dashboard" : "/attendance");
}

// 로그아웃
export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}
