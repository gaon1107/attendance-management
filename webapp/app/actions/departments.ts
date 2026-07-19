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

// 회사 결재방식 저장 — 단일 승인(single, 기존) ↔ 부서장 결재선(deptline). 단계수 1~3 클램프.
export async function saveApprovalMode(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const mode = String(formData.get("approvalMode") ?? "single");
  const approvalMode = mode === "deptline" ? "deptline" : "single"; // 화이트리스트
  let count = parseInt(String(formData.get("approvalStepCount") ?? "1"), 10);
  if (!Number.isFinite(count)) count = 1;
  const approvalStepCount = Math.max(1, Math.min(count, 3)); // 방어: 1~3

  await prisma.company.update({ where: { id: me.companyId }, data: { approvalMode, approvalStepCount } });
  revalidatePath("/employees");
  revalidatePath("/settings");
}

// 부서 결재설정 저장 — 부서장·상위부서·대결자. 전부 선택(빈 값=해제).
//  · 부서장/대결자: 지정 시 내 회사 직원이어야 한다(아니면 저장 거부).
//  · 상위부서: 내 회사 부서 + 자기 자신 금지 + 순환참조(A→B→A) 금지.
export async function saveDepartmentApproval(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const dept = await prisma.department.findFirst({ where: { id, companyId: me.companyId } });
  if (!dept) return;

  // 직원 존재 검증: 빈 값 → null(해제), 유효 → id, 무효 → undefined(저장 중단)
  const validUser = async (raw: string): Promise<string | null | undefined> => {
    const uid = raw.trim();
    if (!uid) return null;
    const u = await prisma.user.findFirst({ where: { id: uid, companyId: me.companyId }, select: { id: true } });
    return u ? u.id : undefined;
  };
  const headUserId = await validUser(String(formData.get("headUserId") ?? ""));
  if (headUserId === undefined) return;
  const deputyUserId = await validUser(String(formData.get("deputyUserId") ?? ""));
  if (deputyUserId === undefined) return;

  // 상위부서: 순환참조 방어
  let parentId: string | null = null;
  const rawParent = String(formData.get("parentId") ?? "").trim();
  if (rawParent) {
    if (rawParent === id) return; // 자기 자신을 상위부서로 지정 금지
    const all = await prisma.department.findMany({ where: { companyId: me.companyId }, select: { id: true, parentId: true } });
    const parentOf = new Map(all.map((d) => [d.id, d.parentId]));
    if (!parentOf.has(rawParent)) return; // 내 회사 부서 아님
    // rawParent에서 위로 올라가며 이 부서(id)를 만나면 순환 → 거부
    let cur: string | null | undefined = rawParent;
    const seen = new Set<string>();
    while (cur) {
      if (cur === id) return;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    parentId = rawParent;
  }

  // 전결권자 지정(체크박스). 켜면 이 부서장 승인에서 결재선이 종결(상위로 안 올라감).
  const finalApproval = formData.get("finalApproval") !== null;

  await prisma.department.update({ where: { id: dept.id }, data: { headUserId, parentId, deputyUserId, finalApproval } });
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
