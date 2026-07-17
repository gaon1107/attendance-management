// 직원별 근태 상세 — 관리자 전용. 기간 내 날짜별 출퇴근/외출/실근무/지각 + 결근·휴일근무. (리뉴얼 디자인)
//  · 표 보기: 기존 그대로(PeriodNav 일/주/월 + DetailTable, 본인 확인 열 포함).
//  · 달력 보기: 월 단위(내 근태와 동일한 MonthCalendar 재활용). view=cal 일 때만.
// ※ 회사 격리: userId가 내 회사 소속이 아니면 보여주지 않는다(notFound).
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { PeriodNav } from "@/app/components/PeriodNav";
import { DetailTable } from "@/app/components/DetailTable";
import { MonthCalendar } from "@/app/components/MonthCalendar";
import { buildDayEntries } from "@/lib/dayentries";
import { leaveLabelByDate } from "@/lib/leave";
import { loadOffDays } from "@/lib/holiday-server";
import { normalizeUnit, parseAnchor, rangeFor, shiftAnchor, toISODate } from "@/lib/period";

// 표/달력 전환 토글(내 근태와 동일한 모양).
const tabStyle = (on: boolean): React.CSSProperties => ({
  height: 34, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 6,
  fontSize: 14, fontWeight: 700, textDecoration: "none",
  background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--text-sub)",
  boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
});
function Toggle({ tableHref, calHref, isCal }: { tableHref: string; calHref: string; isCal: boolean }) {
  return (
    <div style={{ display: "inline-flex", background: "#EEF2F7", borderRadius: 8, padding: 3 }}>
      <Link href={tableHref} style={tabStyle(!isCal)}>표</Link>
      <Link href={calHref} style={tabStyle(isCal)}>달력</Link>
    </div>
  );
}

export default async function RecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ unit?: string; date?: string; view?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const { userId } = await params;
  // 회사 격리 — 반드시 내 회사 소속 직원만 조회
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId } });
  if (!target) notFound();

  const sp = await searchParams;
  const isCal = sp.view === "cal";
  // 근태 상세는 기본값을 "일"로 — 근태현황에서 특정 날짜를 클릭해 들어오면 그 날을 먼저 보여준다.
  // (unit 파라미터가 없을 때만 day. 주/월은 탭으로 그대로 선택 가능.)
  const unit = normalizeUnit(sp.unit ?? "day");
  const anchor = parseAnchor(sp.date);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, workEndTime: true, lateGraceMin: true, workDays: true, holidayAutoOn: true },
  });

  // 기간(start~end)으로 이 직원의 출퇴근 + 승인 휴가를 모아 상세를 만든다.
  async function loadDetail(start: Date, end: Date) {
    const offDays = await loadOffDays(me!.companyId, company?.holidayAutoOn ?? true, start, end);
    const rows = await prisma.attendance.findMany({
      where: { userId: target!.id, companyId: me!.companyId, clockIn: { gte: start, lt: end } },
      include: {
        breaks: true,
        // 출퇴근 촬영 사진·판독 기록(관리자 전용 "본인 확인" 열) — 파일 이름 등 내부 정보는 내리지 않는다
        clockPhotos: {
          select: { id: true, kind: true, livenessStatus: true, livenessScore: true, fileDeletedAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { clockIn: "desc" },
    });
    // 이 기간에 걸치는 승인된 이 직원의 휴가 → 날짜별 라벨(결근 대신 "휴가")
    const leaves = await prisma.leaveRequest.findMany({
      where: { userId: target!.id, companyId: me!.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { type: true, startDate: true, endDate: true },
    });
    return buildDayEntries(rows, target!.workDays, company, start, end, leaveLabelByDate(leaves), offDays);
  }

  const backBtn = (
    <Link href="/records" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 근태 현황
    </Link>
  );

  // ── 달력 보기 (월 단위) ──────────────────────────────
  if (isCal) {
    const { start, end, label } = rangeFor("month", anchor);
    const detail = await loadDetail(start, end);

    const prev = toISODate(shiftAnchor("month", anchor, -1));
    const next = toISODate(shiftAnchor("month", anchor, 1));
    const navBtn: React.CSSProperties = { width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", textDecoration: "none", fontWeight: 700 };

    return (
      <AppShell user={me} active="records" title={`${target.name} 님 근태 상세`} subtitle={me.company.name} right={backBtn}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link href={`/records/${target.id}?date=${prev}&view=cal`} style={navBtn}>◀</Link>
            <div style={{ fontSize: 18, fontWeight: 700, minWidth: 150, textAlign: "center" }}>{label}</div>
            <Link href={`/records/${target.id}?date=${next}&view=cal`} style={navBtn}>▶</Link>
          </div>
          <Toggle tableHref={`/records/${target.id}?unit=month&date=${toISODate(anchor)}`} calHref={`/records/${target.id}?date=${toISODate(anchor)}&view=cal`} isCal />
        </div>
        <MonthCalendar year={anchor.getFullYear()} month={anchor.getMonth()} entries={detail.entries} />
      </AppShell>
    );
  }

  // ── 표 보기 (기존 그대로: 일/주/월) ───────────────────
  const { start, end, label } = rangeFor(unit, anchor);
  const detail = await loadDetail(start, end);

  return (
    <AppShell user={me} active="records" title={`${target.name} 님 근태 상세`} subtitle={me.company.name} right={backBtn}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <PeriodNav basePath={`/records/${target.id}`} unit={unit} anchor={anchor} label={label} />
        <Toggle tableHref={`/records/${target.id}?unit=${unit}&date=${toISODate(anchor)}`} calHref={`/records/${target.id}?date=${toISODate(anchor)}&view=cal`} isCal={false} />
      </div>
      {/* 관리자 화면에만 "본인 확인"(판독·사진) 열을 켠다 — 직원 본인 화면(my-records)은 기존 그대로 */}
      <DetailTable detail={detail} showLiveness />
    </AppShell>
  );
}
