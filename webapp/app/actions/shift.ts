"use server";
// 근무표(교대 배정) 서버 액션. 회사 격리·관리자 권한 검증. 설계: docs/04_architecture/교대근무_설계.md
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";

// [방식 ⓐ 고정] 요일 패턴 저장 — 직원×요일(0~6) → 조. 빈값/잘못된 값 = 휴무(null).
//  · 폼: userIds(CSV) + 각 셀 pat_{userId}_{dow} = shiftId | "".
//  · order 유지 위해 (userId,dayOfWeek) 유니크로 upsert. 한 트랜잭션으로 잠금·정합 안전.
export async function saveFixedPattern(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { shiftMode: true, scheduleType: true },
  });
  if (!company?.shiftMode || company.scheduleType !== "fixed") {
    return { error: "고정 요일패턴 모드가 아닙니다. [설정]에서 먼저 지정하세요." };
  }
  const shifts = await prisma.shift.findMany({ where: { companyId: me.companyId }, select: { id: true } });
  const validShiftIds = new Set(shifts.map((s) => s.id));

  const userIds = String(formData.get("userIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // 회사 소속 직원만 허용(테넌트 격리)
  const employees = await prisma.user.findMany({
    where: { id: { in: userIds }, companyId: me.companyId },
    select: { id: true },
  });
  const allowed = new Set(employees.map((e) => e.id));

  const ops = [];
  for (const uid of userIds) {
    if (!allowed.has(uid)) continue;
    for (let dow = 0; dow < 7; dow++) {
      const raw = String(formData.get(`pat_${uid}_${dow}`) ?? "").trim();
      const shiftId = raw && validShiftIds.has(raw) ? raw : null; // 빈값·잘못된 값 = 휴무
      ops.push(
        prisma.shiftPattern.upsert({
          where: { userId_dayOfWeek: { userId: uid, dayOfWeek: dow } },
          update: { shiftId },
          create: { companyId: me.companyId, userId: uid, dayOfWeek: dow, shiftId },
        })
      );
    }
  }
  await prisma.$transaction(ops);

  revalidatePath("/shifts");
  return { ok: true };
}
