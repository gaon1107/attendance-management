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
  redirect("/dashboard");
}

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
  if (!user || !verifyPassword(password, user.passwordHash)) {
    // 보안: 이메일/비번 중 무엇이 틀렸는지 구분해 알려주지 않는다.
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
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
