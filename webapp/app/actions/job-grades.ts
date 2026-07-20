"use server";
// 직급(직위) 사다리 관리 — 관리자 전용. 회사마다 자기 직급을 만들고 순서(서열)를 정한다.
//  · 서열(level)은 클수록 상급. 새 직급은 맨 위(최고 서열+10)로 추가하고, ↑↓로 이웃과 서열을 맞바꾼다.
//  · 결재선 상급자 판별에 쓰인다(2단계). 여기선 직급 데이터만 관리(결재 로직 무접촉).
//  · 회사 격리: 모든 동작은 내 회사(companyId) 것만.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

const MAX_NAME = 30;

// 직급 만들기 — 같은 회사 같은 이름 중복 금지. 서열은 현재 최고 +10(맨 위).
export async function createJobGrade(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "직급 이름을 입력해주세요." };
  if (Array.from(name).length > MAX_NAME) return { error: `직급 이름은 ${MAX_NAME}자 이내로 입력해주세요.` };

  const dup = await prisma.jobGrade.findFirst({ where: { companyId: me.companyId, name } });
  if (dup) return { error: "이미 있는 직급 이름입니다." };

  const top = await prisma.jobGrade.findFirst({ where: { companyId: me.companyId }, orderBy: { level: "desc" }, select: { level: true } });
  const level = (top?.level ?? 0) + 10;

  await prisma.jobGrade.create({ data: { companyId: me.companyId, name, level } });
  revalidatePath("/employees");
  return { ok: true };
}

// 직급 이름 바꾸기 — 내 회사 직급만. 같은 이름 중복 금지(자기 제외).
export async function renameJobGrade(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || Array.from(name).length > MAX_NAME) return;

  const grade = await prisma.jobGrade.findFirst({ where: { id, companyId: me.companyId } });
  if (!grade) return;
  const dup = await prisma.jobGrade.findFirst({ where: { companyId: me.companyId, name, id: { not: id } } });
  if (dup) return;

  await prisma.jobGrade.update({ where: { id: grade.id }, data: { name } });
  revalidatePath("/employees");
}

// 직급 서열 이동 — 위(상급)/아래(하급)로 이웃과 level을 맞바꾼다.
export async function moveJobGrade(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("dir") ?? ""); // "up"=상급쪽 | "down"=하급쪽
  if (dir !== "up" && dir !== "down") return;

  const grade = await prisma.jobGrade.findFirst({ where: { id, companyId: me.companyId } });
  if (!grade) return;

  // up = level이 나보다 바로 위(가장 가까운 큰 값), down = 바로 아래(가장 가까운 작은 값)
  const neighbor = await prisma.jobGrade.findFirst({
    where: {
      companyId: me.companyId,
      level: dir === "up" ? { gt: grade.level } : { lt: grade.level },
    },
    orderBy: { level: dir === "up" ? "asc" : "desc" },
  });
  if (!neighbor) return; // 이미 끝

  // level 맞바꿈(트랜잭션). level에 unique 제약이 없어 단순 교환으로 안전.
  await prisma.$transaction([
    prisma.jobGrade.update({ where: { id: grade.id }, data: { level: neighbor.level } }),
    prisma.jobGrade.update({ where: { id: neighbor.id }, data: { level: grade.level } }),
  ]);
  revalidatePath("/employees");
}

// 직급 삭제 — 내 회사 직급만. 소속 직원은 지우지 않고 "미지정"(null)으로 되돌린다(외래키 안전).
export async function deleteJobGrade(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("id") ?? "");
  const grade = await prisma.jobGrade.findFirst({ where: { id, companyId: me.companyId } });
  if (!grade) return;

  await prisma.user.updateMany({ where: { jobGradeId: grade.id, companyId: me.companyId }, data: { jobGradeId: null } });
  await prisma.jobGrade.delete({ where: { id: grade.id } });
  revalidatePath("/employees");
}
