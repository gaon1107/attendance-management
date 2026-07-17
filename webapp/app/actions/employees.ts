"use server";
// 직원 등록 — 관리자만 가능. 같은 회사 소속으로 직원 계정을 만든다.
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseDays, daysToCsv } from "@/lib/workdays";
import { parseProfile, employeeNoTaken } from "@/lib/employee-profile";

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

// 직원 인적정보(전화번호·직급·사번·입사일) 수정 — 관리자만. 내 회사 소속만(회사 격리).
// 전부 선택 항목이라 빈 칸으로 두면 해당 값을 지운다(null 저장).
export async function updateEmployeeProfile(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { error: "권한이 없습니다." };
  }

  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  const parsed = parseProfile(formData);
  if (!parsed.ok) return { error: parsed.error };
  // 사번 중복검사 — 같은 회사 다른 활성 직원과 겹치면 저장 거부(본인은 제외).
  //  · 사번이 "실제로 바뀐" 경우에만 검사한다. 기능 도입 前 이미 중복이던 레거시 데이터가 있어도
  //    사번을 안 건드린 저장(전화번호만 수정 등)은 막지 않기 위함(중복은 다음에 사번을 고칠 때 정리됨).
  if (
    parsed.profile.employeeNo !== target.employeeNo &&
    (await employeeNoTaken(me.companyId, parsed.profile.employeeNo, target.id))
  ) {
    return { error: "이미 같은 사번을 쓰는 직원이 있습니다. 다른 사번을 입력해 주세요." };
  }
  await prisma.user.update({
    where: { id: target.id },
    data: {
      phone: parsed.profile.phone,
      position: parsed.profile.position,
      employeeNo: parsed.profile.employeeNo,
      hireDate: parsed.profile.hireDate,
    },
  });

  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
  return { ok: true };
}

// 직원 퇴사(비활성화) — 관리자만. 계정을 막되 과거 근태 기록은 보존한다(법정 3년 보존).
// 비활성화하면 로그인 불가 + 즉시 로그아웃(세션 삭제) + 직원 수 집계 제외.
export async function deactivateEmployee(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  // 본인·관리자 계정은 퇴사 처리 대상이 아니다(방어).
  if (!target || target.id === me.id || target.role === "admin") return;

  await prisma.user.update({ where: { id: target.id }, data: { deactivatedAt: new Date() } });
  // 이미 로그인해 있던 세션도 즉시 무효화
  await prisma.session.deleteMany({ where: { userId: target.id } });

  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
}

// 복직(재활성화) — 관리자만. 다시 로그인 가능하게 하고 로그인 잠금도 초기화한다.
export async function reactivateEmployee(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return;

  await prisma.user.update({
    where: { id: target.id },
    data: { deactivatedAt: null, failedLoginCount: 0, lockedUntil: null },
  });

  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
}

// 직원 비밀번호 재설정 — 관리자만. 직원이 비번을 잊었을 때 새 임시 비번을 정해준다.
// 보안: 재설정하면 그 직원의 기존 로그인 세션도 무효화(새 비번으로 다시 로그인).
export async function resetEmployeePassword(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };

  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: hashPassword(password), failedLoginCount: 0, lockedUntil: null },
  });
  await prisma.session.deleteMany({ where: { userId: target.id } });

  revalidatePath(`/employees/${id}`);
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
