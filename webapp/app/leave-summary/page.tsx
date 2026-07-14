// 연차 정산 내역 — 관리자 전용(간소형). 전 직원의 발생·사용·잔여를 연도별로 한 표에.
//  · 발생 = 관리자가 설정한 annualLeaveDays(연도 개념 없음 → "현재 설정값 기준" 안내 표기).
//  · 사용 = 그 연도에 시작하는 승인된 연차·반차 합계(usedLeaveDaysInYear).
//  · 잔여 = 발생 − 사용. (소멸 예정·촉진 필요는 데이터 없어 이번 범위 제외)
// ※ 회사 격리: 내 회사 소속 재직 직원만 집계.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { usedLeaveDaysInYear } from "@/lib/leave";
import { toISODate } from "@/lib/period";
import { LeaveSummaryClient, type LeaveSummaryRow } from "./LeaveSummaryClient";

export default async function LeaveSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const thisYear = new Date().getFullYear();
  // 연도 파라미터 검증(올해~올해-4만 허용). 벗어나면 올해.
  const yParam = Number(sp.year);
  const year = Number.isInteger(yParam) && yParam <= thisYear && yParam >= thisYear - 4 ? yParam : thisYear;
  const years = [thisYear, thisYear - 1, thisYear - 2];

  const employees = await prisma.user.findMany({
    where: { companyId: me.companyId, role: "employee", deactivatedAt: null },
    select: { id: true, name: true, hireDate: true, annualLeaveDays: true, department: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // 그 연도에 시작하는 승인 연차·반차만(성능 위해 연도 범위로 1차 필터) → 사용자별로 묶는다.
  const yStart = new Date(year, 0, 1);
  const yEnd = new Date(year + 1, 0, 1);
  const leaves = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "approved", startDate: { gte: yStart, lt: yEnd } },
    select: { userId: true, type: true, days: true, status: true, startDate: true },
  });
  const byUser = new Map<string, typeof leaves>();
  for (const lv of leaves) {
    const arr = byUser.get(lv.userId);
    if (arr) arr.push(lv);
    else byUser.set(lv.userId, [lv]);
  }

  const rows: LeaveSummaryRow[] = employees.map((e) => {
    const used = usedLeaveDaysInYear(byUser.get(e.id) ?? [], year);
    const granted = e.annualLeaveDays;
    return {
      id: e.id,
      name: e.name,
      dept: e.department?.name ?? "미배정",
      hireDate: e.hireDate ? toISODate(e.hireDate) : "",
      granted,
      used,
      // 부동소수 합산 오차 방지: 소수 1자리로 반올림(반차 0.5 단위)
      remain: Math.round((granted - used) * 10) / 10,
    };
  });

  return (
    <AppShell user={me} active="leave-summary" title="연차정산" subtitle={me.company.name}>
      <LeaveSummaryClient rows={rows} year={year} years={years} exportBase={`/leave-summary/export?year=${year}`} />
    </AppShell>
  );
}
