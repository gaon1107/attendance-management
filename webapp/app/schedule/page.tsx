// 일정 캘린더 — 월 달력에서 날짜를 클릭해 일정을 등록한다. 관리자·직원 모두 접근(역할분기).
//  · 관리자: 회사 일정·회사 휴무일 등록/삭제 가능.
//  · 직원: 회사 공휴일·휴무일·회사 일정은 보기만, 본인 개인 일정만 등록/삭제.
//  · 법정공휴일(Holiday)·회사 휴무일(CompanyHoliday)·일정(CompanyEvent)을 한 달력에 함께 표시.
//  · 서버는 이 달 데이터만 모아 넘기고, 클릭·모달·등록은 ScheduleCalendar(클라이언트)가 담당한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { ScheduleCalendar, type DayData } from "./ScheduleCalendar";
import { MarkNoticesSeen } from "@/app/notice/MarkNoticesSeen";
import { toISODate } from "@/lib/period";

const pad = (n: number) => String(n).padStart(2, "0");

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const isAdmin = me.role === "admin";

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
  // 공지(작성일 기준) 조회 범위 = 이 달 1일 00:00 ~ 다음 달 1일 00:00
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);

  // 일정 조회 범위 — 관리자: 회사 일정(userId=null)만. 직원: 회사 일정 + 본인 개인 일정(프라이버시상 남의 개인은 제외).
  const eventWhere = isAdmin
    ? { companyId: me.companyId, date: { startsWith: monthPrefix }, userId: null }
    : { companyId: me.companyId, date: { startsWith: monthPrefix }, OR: [{ userId: null }, { userId: me.id }] };

  // 이 달 데이터: 법정공휴일(전국 공용) + 회사 휴무일 + 일정 + 공지(작성일 기준)
  const [nat, comp, events, notices] = await Promise.all([
    prisma.holiday.findMany({ where: { date: { startsWith: monthPrefix } }, select: { date: true, name: true } }),
    prisma.companyHoliday.findMany({ where: { companyId: me.companyId, date: { startsWith: monthPrefix } }, select: { id: true, date: true, name: true } }),
    prisma.companyEvent.findMany({ where: eventWhere, select: { id: true, date: true, title: true, color: true, userId: true }, orderBy: { createdAt: "asc" } }),
    // 이 달에 표시할 공지 = 표시 날짜(noticeDate)가 이 달이거나, 표시 날짜 미지정이면 작성일(createdAt)이 이 달인 것.
    prisma.announcement.findMany({
      where: {
        companyId: me.companyId,
        OR: [
          { noticeDate: { startsWith: monthPrefix } },
          { noticeDate: null, createdAt: { gte: monthStart, lt: monthEnd } },
        ],
      },
      select: { id: true, title: true, body: true, authorName: true, createdAt: true, noticeDate: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // 날짜(ISO) → 그 날의 데이터로 합친다. mine = 내가 삭제할 수 있는 일정인지(관리자=회사 일정 / 직원=본인 개인).
  const byDate: Record<string, DayData> = {};
  const ensure = (iso: string): DayData => (byDate[iso] ??= { events: [] });
  for (const h of nat) ensure(h.date).nationalHoliday = h.name;
  for (const c of comp) ensure(c.date).companyHoliday = { id: c.id, name: c.name };
  for (const e of events) {
    const mine = isAdmin ? e.userId === null : e.userId === me.id;
    ensure(e.date).events.push({ id: e.id, title: e.title, color: e.color, mine, personal: e.userId !== null });
  }
  // 공지는 표시 날짜(noticeDate) 칸에 표시. 미지정이면 작성일(createdAt)의 로컬 날짜(ISO)로 버킷팅.
  for (const nt of notices) {
    const iso = nt.noticeDate ?? toISODate(nt.createdAt);
    const day = ensure(iso);
    (day.notices ??= []).push({ id: nt.id, title: nt.title, body: nt.body, authorName: nt.authorName });
  }
  // "새 알림 NEW" 읽음처리는 지금 보고 있는 이 달에 안 읽은 공지가 실제로 있을 때만 한다.
  // (다른 달을 열었을 뿐인데 못 본 공지의 배지가 사라지는 것을 막는다.)
  const hasUnseenThisMonth = notices.some((nt) => !me.noticesSeenAt || nt.createdAt > me.noticesSeenAt);

  // 월 이동 링크용(이전/다음/오늘 달)
  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const prevYm = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
  const nextYm = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
  const todayYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  return (
    <AppShell user={me} active="schedule" title="일정 캘린더" subtitle={me.company.name}>
      {/* 이 달에 안 읽은 공지가 있을 때만 읽음 처리 → 출퇴근 화면의 "새 알림 NEW" 배지를 지운다. */}
      <MarkNoticesSeen active={hasUnseenThisMonth} />
      <ScheduleCalendar
        year={year}
        month={month}
        todayISO={toISODate(now)}
        byDate={byDate}
        prevYm={prevYm}
        nextYm={nextYm}
        todayYm={todayYm}
        canManageCompany={isAdmin}
      />
    </AppShell>
  );
}
