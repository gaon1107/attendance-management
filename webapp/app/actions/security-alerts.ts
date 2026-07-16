"use server";
// 이상접속 "확인함" 처리(접속/보안 6단계) — 관리자만.
//  · 하는 일은 단 하나: Company.securityCheckedAt = 지금. 대시보드 배지는 이 시각 이후 이상건만 센다.
//  · 이상 기록 자체는 지우지 않는다 — 확인은 "봤다"는 표시일 뿐, 감사 기록은 그대로 남아야 한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

export async function markSecurityChecked(): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return; // 권한 없으면 조용히 무시(폼 액션이라 반환값을 안 씀)

  await prisma.company.update({
    where: { id: me.companyId },
    data: { securityCheckedAt: new Date() },
  });

  // 감사로그 — "누가 언제 이상접속을 확인했나"도 관리자 동작이다(성공 뒤에만).
  await logAdminAction(me, "config", "security_checked");

  revalidatePath("/security/alerts");
  revalidatePath("/dashboard"); // 배지가 즉시 꺼지도록
}
