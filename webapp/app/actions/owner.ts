"use server";
// 관리자 지정·해제 — 회사 계정(마스터 키)과 관리자들이 함께 쓰는 기능.
//
// 왜 필요한가 (2026-07-27 사장님 지적)
//  · 예전에는 회원가입한 사람이 유일한 관리자였고, 관리자를 더 만들 방법도, 넘길 방법도,
//    퇴사시킬 방법도 없었다. 그 사람이 나가면 회사 데이터에 아무도 들어갈 수 없었다.
//  · 이제 가입으로 만들어지는 것은 **회사 계정**(사람 아님)이고, 실무 관리자는 여기서 지정한다.
//
// 지키는 규칙
//  · 🔒 **회사 계정(isOwner)은 아무도 강등·퇴사시킬 수 없다.** 이것이 "회사가 잠기지 않는다"의 근거다.
//  · 관리자 권한은 전부 동일하다(사장님 결정) — 관리자끼리 서로 지정·해제할 수 있다.
//  · 본인 권한은 스스로 바꿀 수 없다(실수로 자기를 강등해 화면에서 튕기는 것을 막는다).
//  · 회사 격리: 대상은 반드시 내 회사 사람이어야 한다(companyId 조건 필수).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { canChangeRole } from "@/lib/owner-rules";
import { revalidatePath } from "next/cache";

/**
 * 직원 ↔ 관리자 전환.
 *  · `makeAdmin=1`이면 관리자로 지정, 아니면 일반 직원으로 되돌린다.
 *  · 권한이 바뀌면 다음 화면 요청부터 즉시 반영된다(getCurrentUser가 매번 DB를 읽는다) —
 *    강제 로그아웃시키지 않는 이유다. 쓰던 화면에서 갑자기 튕기지 않고 자연스럽게 바뀐다.
 */
export async function setAdminRole(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;

  const id = String(formData.get("userId") ?? "");
  const makeAdmin = String(formData.get("makeAdmin") ?? "") === "1";

  // 회사 격리 — 반드시 내 회사 사람만 조회한다.
  const target = await prisma.user.findFirst({
    where: { id, companyId: me.companyId },
    select: { id: true, role: true, isOwner: true, deactivatedAt: true },
  });

  // 판단은 lib/owner-rules.ts 한 곳에서 한다(퇴사 처리와 같은 규칙을 공유).
  const rule = canChangeRole(me, target, makeAdmin);
  if (!rule.ok) return;

  await prisma.user.update({
    where: { id: rule.target.id },
    data: { role: makeAdmin ? "admin" : "employee" },
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${rule.target.id}`);
}
