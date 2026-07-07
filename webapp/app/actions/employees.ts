"use server";
// 직원 등록 — 관리자만 가능. 같은 회사 소속으로 직원 계정을 만든다.
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseDays, daysToCsv } from "@/lib/workdays";

export async function addEmployee(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !email || !password) {
    return { error: "모든 항목을 입력해주세요." };
  }
  if (password.length < 8) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "이미 사용 중인 이메일입니다." };
  }

  await prisma.user.create({
    data: {
      companyId: me.companyId, // 관리자와 같은 회사로
      email,
      name,
      passwordHash: hashPassword(password),
      role: "employee",
    },
  });

  revalidatePath("/employees");
  return { ok: true };
}

// 직원 이름 수정 — 관리자만. 반드시 내 회사 소속 직원만 수정(회사 격리).
export async function updateEmployeeName(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "이름을 입력해주세요." };

  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  await prisma.user.update({ where: { id: target.id }, data: { name } });

  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
  return { ok: true };
}

// 직원 근무요일 예외 저장 — 관리자만. 빈 값이면 "회사 기본 따름"(null). 회사 격리.
export async function updateEmployeeWorkDays(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("workDays") ?? "").trim();

  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  // 빈 값 = 회사 기본 따름(null). 값이 있으면 정규화해서 저장.
  const value = raw ? daysToCsv(parseDays(raw)) : null;
  await prisma.user.update({ where: { id: target.id }, data: { workDays: value } });

  revalidatePath(`/employees/${id}`);
  return { ok: true };
}
