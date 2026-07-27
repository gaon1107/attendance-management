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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS = new Set(["day", "week", "month"]);

// 형식 + 실제로 존재하는 날짜인지(2026-02-30·2026-13-45 차단). 재구성 값이 원문과 일치해야 통과.
function isRealDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

// [방식 ⓑ 순환] 조 배정 + 순환 규칙 저장.
//  · 조(ShiftGroup) 개수 = 교대 수(shiftMode). order 0,1,2 = A,B,C. 여기서 처음 생성(order 기준 upsert로 id 유지).
//  · 폼: userIds(CSV) + 각 group_{userId} = 조 order(0~) | ""(미배정) / unit(day|week|month) / anchorDate(YYYY-MM-DD).
//  · 순환 순서(orderCsv)는 표준 고정: "1,2,...,shiftMode"(1교대→2교대→…). 판정 연결은 Phase 4.
export async function saveRotation(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { shiftMode: true, scheduleType: true },
  });
  if (!company?.shiftMode || company.scheduleType !== "rotation") {
    return { error: "순환 배정 모드가 아닙니다. [설정]에서 먼저 지정하세요." };
  }
  const n = company.shiftMode;

  const unit = String(formData.get("unit") ?? "").trim();
  if (!UNITS.has(unit)) return { error: "순환 단위를 매일·매주·매월 중에서 선택해주세요." };
  const anchorDate = String(formData.get("anchorDate") ?? "").trim();
  if (!isRealDate(anchorDate)) return { error: "시작 기준일을 올바른 날짜로 선택해주세요." };
  const orderCsv = Array.from({ length: n }, (_, i) => i + 1).join(","); // 표준 고정 순서

  const userIds = String(formData.get("userIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // 회사 소속 + 재직 중인 **사람**만 허용(테넌트 격리 + 화면 배정대상과 동일 집합 → 퇴사자 배정 방지)
  //  · 2026-07-27: 관리자도 근로자이므로 배정 대상에 포함한다. 사람이 아닌 **회사 계정만** 뺀다(isOwner).
  const employees = await prisma.user.findMany({
    where: { id: { in: userIds }, companyId: me.companyId, isOwner: false, deactivatedAt: null },
    select: { id: true },
  });
  const allowed = new Set(employees.map((e) => e.id));

  try {
    await prisma.$transaction(async (tx) => {
    // 1) 조 A/B/C 보장(order 기준 upsert → id 유지, 기존 배정·규칙이 안 끊김)
    const groupIdByOrder: Record<number, string> = {};
    for (let o = 0; o < n; o++) {
      const g = await tx.shiftGroup.upsert({
        where: { companyId_order: { companyId: me.companyId, order: o } },
        update: {},
        create: { companyId: me.companyId, order: o, name: null },
      });
      groupIdByOrder[o] = g.id;
    }
    // 2) 교대 수가 줄었으면(3→2) 초과 조 정리 — 참조하는 직원 먼저 해제 후 삭제(FK 안전)
    const excess = await tx.shiftGroup.findMany({
      where: { companyId: me.companyId, order: { gte: n } },
      select: { id: true },
    });
    if (excess.length) {
      const ids = excess.map((e) => e.id);
      await tx.user.updateMany({ where: { companyId: me.companyId, shiftGroupId: { in: ids } }, data: { shiftGroupId: null } });
      await tx.shiftGroup.deleteMany({ where: { id: { in: ids } } });
    }
    // 3) 직원 배정 — group_{uid} = 조 order | ""(미배정=null)
    for (const uid of userIds) {
      if (!allowed.has(uid)) continue;
      const raw = String(formData.get(`group_${uid}`) ?? "").trim();
      const ord = /^\d+$/.test(raw) ? Number(raw) : -1;
      const gid = ord >= 0 && ord < n ? groupIdByOrder[ord] : null;
      await tx.user.update({ where: { id: uid }, data: { shiftGroupId: gid } });
    }
    // 4) 순환 규칙(회사당 1)
    await tx.rotationRule.upsert({
      where: { companyId: me.companyId },
      update: { orderCsv, unit, anchorDate },
      create: { companyId: me.companyId, orderCsv, unit, anchorDate },
    });
    });
  } catch {
    return { error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }

  revalidatePath("/shifts");
  return { ok: true };
}
