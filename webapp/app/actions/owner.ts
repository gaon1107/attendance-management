"use server";
// 관리자 지정·해제 — 회사 계정(마스터 키)과 관리자들이 함께 쓰는 기능.
//
// 왜 필요한가 (2026-07-27 사장님 지적)
//  · 예전에는 회원가입한 사람이 유일한 관리자였고, 관리자를 더 만들 방법도, 넘길 방법도,
//    퇴사시킬 방법도 없었다. 그 사람이 나가면 회사 데이터에 아무도 들어갈 수 없었다.
//  · 이제 가입으로 만들어지는 것은 **회사 계정**(사람 아님)이고, 실무 관리자는 여기서 지정한다.
//
// 지키는 규칙은 전부 lib/owner-rules.ts에 있다(퇴사 처리와 같은 규칙을 공유).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { canChangeRole } from "@/lib/owner-rules";
import { revalidatePath } from "next/cache";

export type AdminToggleState = { error?: string; ok?: string };

/**
 * 직원 ↔ 관리자 전환.
 *  · 권한이 바뀌면 다음 화면 요청부터 즉시 반영된다(getCurrentUser가 매번 DB를 읽는다) —
 *    강제 로그아웃시키지 않는 이유다. 쓰던 화면에서 갑자기 튕기지 않고 자연스럽게 바뀐다.
 *  · ⚠️ **읽기(관리자 수 세기)와 쓰기를 한 트랜잭션으로 묶는다.** 따로 하면 관리자 둘이 동시에
 *    서로를 해제할 때 둘 다 검사를 통과해 **관리자 0명**이 될 수 있다(검수 치명 2).
 *  · 실패하면 이유를 화면에 돌려준다 — 예전에는 아무 반응 없이 실패해 관리자가 영문을 몰랐다(검수 14).
 */
export async function setAdminRole(
  _prev: AdminToggleState,
  formData: FormData
): Promise<AdminToggleState> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("userId") ?? "");
  const makeAdmin = String(formData.get("makeAdmin") ?? "") === "1";

  try {
    return await prisma.$transaction(async (tx) => {
      // 회사 격리 — 반드시 내 회사 사람만 조회한다.
      const target = await tx.user.findFirst({
        where: { id, companyId: me.companyId },
        select: { id: true, role: true, isOwner: true, deactivatedAt: true },
      });

      // 대상을 뺀 "살아있는 관리자" 수 + 회사 계정 유무 → 관리자 0명이 되는 변경을 막는다.
      const otherActiveAdmins = await tx.user.count({
        where: { companyId: me.companyId, role: "admin", isOwner: false, deactivatedAt: null, id: { not: id } },
      });

      const rule = canChangeRole(me, target, makeAdmin, { otherActiveAdmins });
      if (!rule.ok) return { error: rule.reason };

      await tx.user.update({
        where: { id: rule.target.id },
        data: { role: makeAdmin ? "admin" : "employee" },
      });
      return { ok: makeAdmin ? "관리자로 지정했습니다." : "관리자 권한을 해제했습니다." };
    });
  } catch (e) {
    console.warn("[owner] 관리자 권한 변경 실패:", e);
    return { error: "권한을 바꾸지 못했습니다. 잠시 후 다시 시도해주세요." };
  } finally {
    revalidatePath("/employees");
    if (id) revalidatePath(`/employees/${id}`);
  }
}
