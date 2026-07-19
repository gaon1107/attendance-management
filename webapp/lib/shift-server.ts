// 교대근무 판정용 서버 컨텍스트 로더 — 회사가 교대제면 (직원×날짜)→조 해석에 필요한 데이터를
//  화면당 1회 로드해 Map으로 만든다. 비교대(shiftMode=null) 회사는 null을 반환 → 호출부가 기존 판정 유지.
//  · 순수 해석 함수 resolveShift/judgeByShift는 lib/shift.ts(테스트 대상). 여기는 DB 로드만.
//  · 회사격리: 모든 쿼리 companyId 스코프. 설계: docs/04_architecture/교대근무_설계.md
import { prisma } from "@/lib/db";
import type { ShiftContext, ResolvedShift, RotationUnit } from "@/lib/shift";

// startISO(포함) ~ endExclusiveISO(미포함): 예외(ShiftAssignment)를 기간만큼만 로드하기 위한 범위.
//  · 화면의 조회기간(start, end=종료+1일)을 toISODate로 넘기면 된다. date는 문자열이라 ISO 사전순 범위비교 유효.
export async function loadShiftContext(
  companyId: string,
  startISO: string,
  endExclusiveISO: string
): Promise<ShiftContext | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { shiftMode: true, scheduleType: true },
  });
  if (!company?.shiftMode) return null; // 비교대 = 기존 판정 경로
  const scheduleType: "fixed" | "rotation" = company.scheduleType === "rotation" ? "rotation" : "fixed";

  const shifts = await prisma.shift.findMany({
    where: { companyId },
    select: { id: true, order: true, name: true, startTime: true, endTime: true },
  });
  const shiftById = new Map<string, ResolvedShift>();
  const shiftByOrder = new Map<number, ResolvedShift>();
  for (const s of shifts) {
    const rs: ResolvedShift = { order: s.order, name: s.name, startTime: s.startTime, endTime: s.endTime };
    shiftById.set(s.id, rs);
    shiftByOrder.set(s.order, rs);
  }

  const patternByUserDow = new Map<string, string | null>();
  const groupOrderById = new Map<string, number>();
  let rule: ShiftContext["rule"] = null;

  if (scheduleType === "fixed") {
    const pats = await prisma.shiftPattern.findMany({
      where: { companyId },
      select: { userId: true, dayOfWeek: true, shiftId: true },
    });
    for (const p of pats) patternByUserDow.set(`${p.userId}|${p.dayOfWeek}`, p.shiftId ?? null);
  } else {
    const groups = await prisma.shiftGroup.findMany({ where: { companyId }, select: { id: true, order: true } });
    for (const g of groups) groupOrderById.set(g.id, g.order);
    const r = await prisma.rotationRule.findUnique({
      where: { companyId },
      select: { orderCsv: true, unit: true, anchorDate: true },
    });
    if (r) {
      const orderArr = r.orderCsv.split(",").map(Number).filter((n) => !Number.isNaN(n));
      const unit: RotationUnit = r.unit === "day" || r.unit === "month" ? r.unit : "week";
      rule = { orderArr, unit, anchorDate: r.anchorDate };
    }
  }

  // 예외(덮어쓰기) — 조회기간에 걸치는 것만.
  const asgs = await prisma.shiftAssignment.findMany({
    where: { companyId, date: { gte: startISO, lt: endExclusiveISO } },
    select: { userId: true, date: true, shiftId: true },
  });
  const assignmentByUserDate = new Map<string, string | null>();
  for (const a of asgs) assignmentByUserDate.set(`${a.userId}|${a.date}`, a.shiftId ?? null);

  return { scheduleType, shiftById, shiftByOrder, patternByUserDow, groupOrderById, rule, assignmentByUserDate };
}
