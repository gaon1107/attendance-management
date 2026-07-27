// 연차 정산 내역 — 관리자 전용(간소형). 전 직원의 발생·사용·잔여를 연도별로 한 표에.
//  · 발생 = 입사일 기준 자동계산(annualLeaveGranted, 관리자 수동조정 override 우선). 올해만 의미 있음.
//  · 사용 = 그 연도에 시작하는 승인된 연차·반차 합계(usedLeaveDaysInYear).
//  · 잔여 = 발생 − 사용. (소멸 예정·촉진 필요는 데이터 없어 이번 범위 제외)
// ※ 회사 격리: 내 회사 소속 재직 직원만 집계.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { usedLeaveDaysInYear, annualLeaveGranted } from "@/lib/leave";
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
  // 선택 가능한 연도 = 회사 도입연도 ~ 올해(도입 전엔 데이터가 없다). 사용자가 원하는 과거 연도를 자유롭게 본다.
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { createdAt: true } });
  const startYear = company ? company.createdAt.getFullYear() : thisYear;
  // 연도 파라미터 검증(도입연도~올해만 허용). 벗어나면 올해.
  const yParam = Number(sp.year);
  const year = Number.isInteger(yParam) && yParam <= thisYear && yParam >= startYear ? yParam : thisYear;
  const years: number[] = [];
  for (let y = thisYear; y >= startYear; y--) years.push(y); // 내림차순(최신이 위)
  // 올해만 '발생/잔여'가 의미 있다(연도별 발생 이력이 없으므로). 과거 연도는 '사용'만 보여준다.
  const isCurrentYear = year === thisYear;

  // 재직 중인 사람 전부(관리자 포함 — 관리자도 연차를 쓴다). 사람이 아닌 회사 계정만 제외.
  const employees = await prisma.user.findMany({
    where: { companyId: me.companyId, isOwner: false, deactivatedAt: null },
    select: { id: true, name: true, employeeNo: true, hireDate: true, annualLeaveOverride: true, department: { select: { name: true } } },
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
    // 과거 연도는 그 해 부여량(발생) 이력이 없다 → 발생·잔여를 null(화면 "—")로 두고 '사용'만 정확히 보여준다.
    const granted = isCurrentYear ? annualLeaveGranted(e) : null;
    const remain = granted === null ? null : Math.round((granted - used) * 10) / 10; // 부동소수 오차 방지
    return {
      id: e.id,
      name: e.name,
      employeeNo: e.employeeNo,
      dept: e.department?.name ?? "미배정",
      hireDate: e.hireDate ? toISODate(e.hireDate) : "",
      granted,
      used,
      remain,
    };
  });

  return (
    <AppShell user={me} active="leave-summary" title="연차정산" subtitle={me.company.name}>
      <LeaveSummaryClient rows={rows} year={year} years={years} isCurrentYear={isCurrentYear} exportBase={`/leave-summary/export?year=${year}`} />
    </AppShell>
  );
}
