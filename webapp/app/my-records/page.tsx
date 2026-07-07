// 내 근태 조회(직원 본인) — 자신의 기간별 출퇴근/실근무/지각 + 결근·휴일근무. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { PeriodNav } from "@/app/components/PeriodNav";
import { DetailTable } from "@/app/components/DetailTable";
import { buildDayEntries } from "@/lib/dayentries";
import { leaveLabelByDate } from "@/lib/leave";
import { normalizeUnit, parseAnchor, rangeFor } from "@/lib/period";

export default async function MyRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; date?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const unit = normalizeUnit(sp.unit);
  const anchor = parseAnchor(sp.date);
  const { start, end, label } = rangeFor(unit, anchor);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, lateGraceMin: true, workDays: true },
  });

  const rows = await prisma.attendance.findMany({
    where: { userId: me.id, companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { breaks: true },
    orderBy: { clockIn: "desc" },
  });

  // 이 기간에 걸치는 승인된 내 휴가 → 날짜별 라벨(결근 대신 "휴가"로 표시)
  const leaves = await prisma.leaveRequest.findMany({
    where: { userId: me.id, companyId: me.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
    select: { type: true, startDate: true, endDate: true },
  });
  const leaveByDate = leaveLabelByDate(leaves);

  // 내 근무요일(예외 없으면 회사 기본)로 결근·지각 판정(휴가일은 결근 제외)
  const detail = buildDayEntries(rows, me.workDays, company, start, end, leaveByDate);

  return (
    <AppShell user={me} active="my-records" title="내 근태" subtitle={`${me.name} 님`}>
      <PeriodNav basePath="/my-records" unit={unit} anchor={anchor} label={label} />
      <DetailTable detail={detail} />
    </AppShell>
  );
}
