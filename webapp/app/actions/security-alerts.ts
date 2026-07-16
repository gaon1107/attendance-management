"use server";
// 이상접속 "확인함" 처리(접속/보안 6단계) — 관리자만.
//  · 하는 일은 단 하나: Company.securityCheckedAt = 지금. 배지는 이 시각 이후 이상건만 센다.
//  · 이상 기록 자체는 지우지 않는다 — 확인은 "봤다"는 표시일 뿐, 감사 기록은 그대로 남아야 한다.
//  · ⚠️ 이 액션은 **보고 있는 기간과 무관하게 "지금까지 전부"**를 확인 처리한다. 화면 버튼 라벨도
//    그렇게 말해야 한다(AlertsClient) — 안 그러면 관리자가 본 적 없는 경보를 조용히 끄게 된다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

export async function markSecurityChecked(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return; // 비로그인 — 누구인지 모르니 기록할 것도 없다

  // 권한 없는 호출은 조용히 넘기지 않는다 — 보안 화면의 동작이라 "시도했다"는 사실 자체가 감사 대상이다.
  if (me.role !== "admin") {
    await logAdminAction(me, "config", "security_checked", "fail");
    return;
  }

  try {
    await prisma.company.update({
      where: { id: me.companyId },
      data: { securityCheckedAt: new Date() },
    });
  } catch (e) {
    // 저장이 실패했으면 "확인함"으로 기록하면 안 된다(감사 원칙 ④ 사실대로).
    console.error("[security-alerts] 확인 처리 실패:", e);
    await logAdminAction(me, "config", "security_checked", "fail");
    return;
  }

  // 감사로그 — "누가 언제 이상접속을 확인했나"도 관리자 동작이다(성공 뒤에만).
  await logAdminAction(me, "config", "security_checked");

  revalidatePath("/security/alerts");
  revalidatePath("/dashboard"); // 배지가 즉시 꺼지도록
}
