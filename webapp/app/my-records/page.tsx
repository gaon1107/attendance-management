// 내 근태 조회(직원 본인) — 표 보기 + 달력 보기 전환. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { PeriodNav } from "@/app/components/PeriodNav";
import { DetailTable } from "@/app/components/DetailTable";
import { MonthCalendar } from "@/app/components/MonthCalendar";
import { buildDayEntries } from "@/lib/dayentries";
import { leaveLabelByDate } from "@/lib/leave";
import { normalizeUnit, parseAnchor, rangeFor, shiftAnchor, toISODate } from "@/lib/period";

export default async function MyRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; date?: string; view?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const isCal = sp.view === "cal";
  // 달력은 항상 월 단위. 표는 일/주/월 선택.
  const unit = isCal ? "month" : normalizeUnit(sp.unit);
  const anchor = parseAnchor(sp.date);
  const { start, end, label } = rangeFor(unit, anchor);
  const anchorISO = toISODate(anchor);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, lateGraceMin: true, workDays: true },
  });

  const rows = await prisma.attendance.findMany({
    where: { userId: me.id, companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { breaks: true },
    orderBy: { clockIn: "desc" },
  });

  // 이 기간에 걸치는 승인된 내 휴가 → 날짜별 라벨(결근 대신 "휴가")
  const leaves = await prisma.leaveRequest.findMany({
    where: { userId: me.id, companyId: me.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
    select: { type: true, startDate: true, endDate: true },
  });
  const leaveByDate = leaveLabelByDate(leaves);

  const detail = buildDayEntries(rows, me.workDays, company, start, end, leaveByDate);

  // 보기 전환 토글(표 / 달력)
  const toggle = (
    <div style={{ display: "inline-flex", background: "#EEF2F7", borderRadius: 8, padding: 3 }}>
      <Link
        href={`/my-records?unit=${unit}&date=${anchorISO}&view=table`}
        style={{ height: 34, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 6, fontSize: 14, fontWeight: 700, textDecoration: "none", background: !isCal ? "#fff" : "transparent", color: !isCal ? "var(--primary)" : "var(--text-sub)", boxShadow: !isCal ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}
      >
        표
      </Link>
      <Link
        href={`/my-records?date=${anchorISO}&view=cal`}
        style={{ height: 34, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 6, fontSize: 14, fontWeight: 700, textDecoration: "none", background: isCal ? "#fff" : "transparent", color: isCal ? "var(--primary)" : "var(--text-sub)", boxShadow: isCal ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}
      >
        달력
      </Link>
    </div>
  );

  if (isCal) {
    const prev = toISODate(shiftAnchor("month", anchor, -1));
    const next = toISODate(shiftAnchor("month", anchor, 1));
    const navBtn: React.CSSProperties = { width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", textDecoration: "none", fontWeight: 700 };
    return (
      <AppShell user={me} active="my-records" title="내 근태" subtitle={`${me.name} 님`}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href={`/my-records?date=${prev}&view=cal`} style={navBtn}>◀</Link>
            <div style={{ fontSize: 18, fontWeight: 700, minWidth: 150, textAlign: "center" }}>{label}</div>
            <Link href={`/my-records?date=${next}&view=cal`} style={navBtn}>▶</Link>
          </div>
          {toggle}
        </div>
        <MonthCalendar year={anchor.getFullYear()} month={anchor.getMonth()} entries={detail.entries} />
      </AppShell>
    );
  }

  return (
    <AppShell user={me} active="my-records" title="내 근태" subtitle={`${me.name} 님`}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>{toggle}</div>
      <PeriodNav basePath="/my-records" unit={unit} anchor={anchor} label={label} />
      <DetailTable detail={detail} />
    </AppShell>
  );
}
