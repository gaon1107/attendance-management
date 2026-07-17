// 일정 캘린더(관리자 전용) — 월 달력에서 날짜를 클릭해 회사 일정을 등록하고, 그 날을 회사 휴무일로 지정할 수 있다.
//  · 법정공휴일(Holiday)·회사 휴무일(CompanyHoliday)·회사 일정(CompanyEvent)을 한 달력에 함께 표시.
//  · 서버는 이 달 데이터만 모아 넘기고, 클릭·모달·등록은 ScheduleCalendar(클라이언트)가 담당한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { ScheduleCalendar, type DayData } from "./ScheduleCalendar";
import { toISODate } from "@/lib/period";

const pad = (n: number) => String(n).padStart(2, "0");

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  // 표시 월 결정(기본 = 이번 달). ym="YYYY-MM"만 허용(이상값은 이번 달).
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // 0-based
  if (sp.ym && /^\d{4}-\d{2}$/.test(sp.ym)) {
    const [y, m] = sp.ym.split("-").map(Number);
    if (m >= 1 && m <= 12 && y >= 2000 && y <= 2100) {
      year = y;
      month = m - 1;
    }
  }
  const monthPrefix = `${year}-${pad(month + 1)}`; // 예: "2026-07"

  // 이 달 데이터: 법정공휴일(전국 공용) + 회사 휴무일 + 회사 일정
  const [nat, comp, events] = await Promise.all([
    prisma.holiday.findMany({ where: { date: { startsWith: monthPrefix } }, select: { date: true, name: true } }),
    prisma.companyHoliday.findMany({ where: { companyId: me.companyId, date: { startsWith: monthPrefix } }, select: { id: true, date: true, name: true } }),
    prisma.companyEvent.findMany({ where: { companyId: me.companyId, date: { startsWith: monthPrefix } }, select: { id: true, date: true, title: true, color: true }, orderBy: { createdAt: "asc" } }),
  ]);

  // 날짜(ISO) → 그 날의 데이터로 합친다.
  const byDate: Record<string, DayData> = {};
  const ensure = (iso: string): DayData => (byDate[iso] ??= { events: [] });
  for (const h of nat) ensure(h.date).nationalHoliday = h.name;
  for (const c of comp) ensure(c.date).companyHoliday = { id: c.id, name: c.name };
  for (const e of events) ensure(e.date).events.push({ id: e.id, title: e.title, color: e.color });

  // 월 이동 링크용(이전/다음/오늘 달)
  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const prevYm = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
  const nextYm = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
  const todayYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  return (
    <AppShell user={me} active="schedule" title="일정 캘린더" subtitle={me.company.name}>
      <ScheduleCalendar
        year={year}
        month={month}
        todayISO={toISODate(now)}
        byDate={byDate}
        prevYm={prevYm}
        nextYm={nextYm}
        todayYm={todayYm}
      />
    </AppShell>
  );
}
