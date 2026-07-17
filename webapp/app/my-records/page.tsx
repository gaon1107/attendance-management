// 내 근태 조회(직원 본인) — 표 보기(기간 자유선택 달력) + 달력 보기(월). (리뉴얼 디자인)
//  · 표 보기: 공통 RangeCalendar로 시작~종료 기간을 고른다(기본 = 이번 달). 일/주/월 탭은 폐지.
//  · 달력 보기: 월 단위(기존 그대로).
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { DetailTable } from "@/app/components/DetailTable";
import { MonthCalendar } from "@/app/components/MonthCalendar";
import { buildDayEntries } from "@/lib/dayentries";
import { leaveLabelByDate } from "@/lib/leave";
import { loadOffDays } from "@/lib/holiday-server";
import { parseAnchor, rangeFor, shiftAnchor, toISODate } from "@/lib/period";

const tabStyle = (on: boolean): React.CSSProperties => ({
  height: 34, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 6,
  fontSize: 14, fontWeight: 700, textDecoration: "none",
  background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--text-sub)",
  boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
});

// 표/달력 전환 토글. tableHref=표 보기로, calHref=달력 보기로.
function Toggle({ tableHref, calHref, isCal }: { tableHref: string; calHref: string; isCal: boolean }) {
  return (
    <div style={{ display: "inline-flex", background: "#EEF2F7", borderRadius: 8, padding: 3 }}>
      <Link href={tableHref} style={tabStyle(!isCal)}>표</Link>
      <Link href={calHref} style={tabStyle(isCal)}>달력</Link>
    </div>
  );
}

export default async function MyRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string; view?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const isCal = sp.view === "cal";
  const todayISO = toISODate(new Date());

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, lateGraceMin: true, workDays: true, holidayAutoOn: true },
  });

  // 기간(start~end)으로 내 출퇴근 + 승인 휴가를 모아 상세를 만든다.
  async function loadDetail(start: Date, end: Date) {
    const offDays = await loadOffDays(me!.companyId, company?.holidayAutoOn ?? true, start, end);
    const rows = await prisma.attendance.findMany({
      where: { userId: me!.id, companyId: me!.companyId, clockIn: { gte: start, lt: end } },
      include: { breaks: true },
      orderBy: { clockIn: "desc" },
    });
    const leaves = await prisma.leaveRequest.findMany({
      where: { userId: me!.id, companyId: me!.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { type: true, startDate: true, endDate: true },
    });
    return buildDayEntries(rows, me!.workDays, company, start, end, leaveLabelByDate(leaves), offDays);
  }

  // ── 달력 보기 (월 단위) ──────────────────────────────
  if (isCal) {
    const anchor = parseAnchor(sp.date);
    const { start, end, label } = rangeFor("month", anchor);
    const detail = await loadDetail(start, end);

    const prev = toISODate(shiftAnchor("month", anchor, -1));
    const next = toISODate(shiftAnchor("month", anchor, 1));
    const mFrom = toISODate(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    const mTo = toISODate(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
    const navBtn: React.CSSProperties = { width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", textDecoration: "none", fontWeight: 700 };

    return (
      <AppShell user={me} active="my-records" title="내 근태" subtitle={`${me.name} 님`}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href={`/my-records?date=${prev}&view=cal`} style={navBtn}>◀</Link>
            <div style={{ fontSize: 18, fontWeight: 700, minWidth: 150, textAlign: "center" }}>{label}</div>
            <Link href={`/my-records?date=${next}&view=cal`} style={navBtn}>▶</Link>
          </div>
          <Toggle tableHref={`/my-records?from=${mFrom}&to=${mTo}&view=table`} calHref={`/my-records?date=${toISODate(anchor)}&view=cal`} isCal />
        </div>
        <MonthCalendar year={anchor.getFullYear()} month={anchor.getMonth()} entries={detail.entries} />
      </AppShell>
    );
  }

  // ── 표 보기 (기간 자유선택) ───────────────────────────
  const now = new Date();
  const defFrom = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const normISO = (s: string | undefined, fb: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00").getTime())) return s;
    return fb;
  };
  const fromISO = normISO(sp.from, defFrom);
  let toISO = normISO(sp.to, defTo);
  if (toISO < fromISO) toISO = fromISO;

  const start = parseAnchor(fromISO);
  start.setHours(0, 0, 0, 0);
  const endDay = parseAnchor(toISO);
  endDay.setHours(0, 0, 0, 0);
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  // 과도한 전량 로드 방지: 최대 92일
  const MAX_DAYS = 92;
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + MAX_DAYS);
  const rangeCapped = end > maxEnd;
  if (rangeCapped) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  const detail = await loadDetail(start, end);

  return (
    <AppShell user={me} active="my-records" title="내 근태" subtitle={`${me.name} 님`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <RangeCalendarNav from={fromISO} to={toISO} todayISO={todayISO} basePath="/my-records" extraQuery={{ view: "table" }} />
        <Toggle tableHref={`/my-records?from=${fromISO}&to=${toISO}&view=table`} calHref={`/my-records?date=${fromISO}&view=cal`} isCal={false} />
      </div>
      {rangeCapped && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, fontWeight: 700, color: "#B45309" }}>
          검색 기간이 너무 길어 시작일부터 최대 {MAX_DAYS}일까지만 표시합니다.
        </div>
      )}
      <DetailTable detail={detail} />
    </AppShell>
  );
}
