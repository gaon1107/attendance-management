"use server";
// 부서 관리 — 관리자 전용. 회사 안에서 부서를 만들고, 이름을 바꾸고, 삭제하고, 직원을 배정한다.
// 회사 격리: 모든 동작은 내 회사(companyId) 것만 다룬다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

// 부서 만들기 — 같은 회사 안 같은 이름은 중복 생성하지 않는다.
export async function createDepartment(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "부서 이름을 입력해주세요." };

  const dup = await prisma.department.findFirst({ where: { companyId: me.companyId, name } });
  if (dup) return { error: "이미 있는 부서 이름입니다." };

  await prisma.department.create({ data: { companyId: me.companyId, name } });
  revalidatePath("/employees");
  return { ok: true };
}

// 부서 이름 바꾸기 — 내 회사 부서만.
export async function renameDepartment(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const dept = await prisma.department.findFirst({ where: { id, companyId: me.companyId } });
  if (!dept) return;
  // 같은 회사에 같은 이름이 이미 있으면(자기 자신 제외) 무시.
  const dup = await prisma.department.findFirst({ where: { companyId: me.companyId, name, id: { not: id } } });
  if (dup) return;

  await prisma.department.update({ where: { id: dept.id }, data: { name } });
  revalidatePath("/employees");
}

// 부서 삭제 — 내 회사 부서만. 소속 직원은 지우지 않고 "미배정"(null)으로 되돌린다.
export async function deleteDepartment(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const dept = await prisma.department.findFirst({ where: { id, companyId: me.companyId } });
  if (!dept) return;

  // 먼저 소속 직원을 미배정으로 → 그 다음 부서 삭제(외래키 안전).
  await prisma.user.updateMany({ where: { departmentId: dept.id }, data: { departmentId: null } });
  await prisma.department.delete({ where: { id: dept.id } });
  revalidatePath("/employees");
}

// 직원을 부서에 배정 — 빈 값이면 미배정(null). 직원·부서 모두 내 회사 소속인지 확인.
export async function assignEmployeeDepartment(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "").trim();

  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  // 부서를 지정했다면 그 부서가 내 회사 것인지 확인.
  let value: string | null = null;
  if (departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: departmentId, companyId: me.companyId } });
    if (!dept) return { error: "부서를 찾을 수 없습니다." };
    value = dept.id;
  }

  await prisma.user.update({ where: { id: target.id }, data: { departmentId: value } });
  revalidatePath(`/employees/${id}`);
  revalidatePath("/employees");
  return { ok: true };
}
