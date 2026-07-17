// 근태 리포트 (관리자 전용) — 시작~종료 날짜(커스텀 달력)로 기간을 정하고, 직원별 실근무·초과근무·결근·외출을 집계.
// 법정기록 CSV 내보내기 포함. 서버는 기간 집계만 계산해 넘기고, 표·검색·달력은 ReportsClient(클라이언트)가 담당한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { ReportsClient, type ReportRow } from "./ReportsClient";
import { workedMinutes } from "@/lib/worktime";
import { parseAnchor, toISODate } from "@/lib/period";
import { effectiveWorkDays, isEffectiveWorkDay } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { leaveDateSet } from "@/lib/leave";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  // 기본 기간: 이번 달 1일 ~ 오늘. from/to는 "YYYY-MM-DD"(달력 값)만 허용 — 이상값은 기본값으로 대체(URL 조작·오타 방어).
  const now = new Date();
  const todayISO = toISODate(now);
  const monthStartISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const normISO = (s: string | undefined, fallback: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T00:00:00");
      if (!Number.isNaN(d.getTime())) return s;
    }
    return fallback;
  };
  const fromISO = normISO(sp.from, monthStartISO);
  let toISO = normISO(sp.to, todayISO);
  if (toISO < fromISO) toISO = fromISO; // 거꾸로 들어오면 표시·조회를 시작일에 맞춤

  // 조회 기간(시작 이상 ~ 종료 다음날 미만 = 종료일 포함).
  const start = parseAnchor(fromISO);
  start.setHours(0, 0, 0, 0);
  const endDay = parseAnchor(toISO);
  endDay.setHours(0, 0, 0, 0);
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  // 과도한 전량 로드 방지: 조회 폭을 최대 92일로 제한(초과 시 잘라내고, 종료 표시도 실제 조회 끝으로 맞춤)
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

  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { workDays: true, standardWorkHours: true, holidayAutoOn: true } });
  // 결근 계산용 쉬는 날(공휴일·회사휴무일) 집합 — 조회 기간 전체.
  const offDays = await loadOffDays(me.companyId, company?.holidayAutoOn ?? true, start, end);
  // 초과근무 판정 기준 = 기준 일 근무시간(분). 하루 실근무가 이보다 많으면 초과분을 연장으로 집계.
  const standardWorkHours = company?.standardWorkHours ?? 8;
  const standardMin = Math.round(standardWorkHours * 60);

  // 기간 내 우리 회사 출퇴근 기록
  const records = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true },
    orderBy: { clockIn: "asc" },
  });

  // 직원별 집계 (+ 초과근무를 위해 날짜별 실근무 분도 모은다)
  const byUser = new Map<string, { id: string; name: string; role: string; minutes: number; breaks: number; days: Set<string>; workDays: string | null; dayMinutes: Map<string, number> }>();
  for (const r of records) {
    const cur = byUser.get(r.userId) ?? { id: r.userId, name: r.user.name, role: r.user.role, minutes: 0, breaks: 0, days: new Set<string>(), workDays: r.user.workDays, dayMinutes: new Map<string, number>() };
    const wm = workedMinutes(r);
    const iso = toISODate(r.clockIn);
    cur.minutes += wm;
    cur.breaks += r.breaks.length;
    cur.days.add(iso);
    cur.dayMinutes.set(iso, (cur.dayMinutes.get(iso) ?? 0) + wm); // 같은 날 여러 기록이면 합산
    byUser.set(r.userId, cur);
  }

  // 초과근무 = 날짜별로 (그 날 실근무 − 기준 일 근무시간)이 양수면 그 합. 기준 이하인 날은 0.
  function overtimeMinutesOf(dayMinutes: Map<string, number>): number {
    let ot = 0;
    for (const dm of dayMinutes.values()) ot += Math.max(0, dm - standardMin);
    return ot;
  }

  // 기간에 걸치는 승인된 휴가 → 직원별 휴가일 집합(결근에서 제외)
  const leaves = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
    select: { userId: true, type: true, startDate: true, endDate: true }, // type: 조퇴는 leaveDateSet에서 제외됨
  });
  const leaveByUser = new Map<string, Set<string>>();
  for (const [uid, list] of Object.entries(
    leaves.reduce<Record<string, { type: string; startDate: Date; endDate: Date }[]>>((acc, l) => {
      (acc[l.userId] ??= []).push(l);
      return acc;
    }, {})
  )) {
    leaveByUser.set(uid, leaveDateSet(list));
  }

  // 결근 = 과거(오늘 이전) 근무일 중 출근 기록도 없고 승인 휴가도 아닌 날
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const absLimit = end < startOfToday ? end : startOfToday;
  function absentCountFor(userWorkDays: string | null, attended: Set<string>, leaveDays: Set<string>): number {
    const wd = effectiveWorkDays(userWorkDays, company?.workDays);
    let n = 0;
    for (let cur = new Date(start); cur < absLimit; cur = new Date(cur.getTime() + 86400000)) {
      const iso = toISODate(cur);
      if (isEffectiveWorkDay(cur, wd, offDays) && !attended.has(iso) && !leaveDays.has(iso)) n++;
    }
    return n;
  }

  // 클라이언트로 넘길 직원별 요약(직렬화 가능한 순수 객체). 검색은 이름 기준.
  const rows: ReportRow[] = [...byUser.values()]
    .map((u) => ({
      id: u.id,
      name: u.name,
      initial: u.name.slice(0, 1),
      isAdmin: u.role === "admin",
      days: u.days.size,
      minutes: u.minutes,
      overtime: overtimeMinutesOf(u.dayMinutes),
      absent: absentCountFor(u.workDays, u.days, leaveByUser.get(u.id) ?? new Set()),
      breaks: u.breaks,
      search: [u.name, u.role === "admin" ? "관리자" : "직원"].join(" ").toLowerCase(),
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // 엑셀 내보내기 링크의 기본 주소(from/to). 검색어(q)는 클라이언트가 실시간으로 덧붙인다.
  const exportBase = `/reports/export?from=${fromISO}&to=${toISO}`;

  return (
    <AppShell user={me} active="reports" title="근태 리포트" subtitle={me.company.name}>
      {rangeCapped && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, fontWeight: 700, color: "#B45309" }}>
          검색 기간이 너무 길어 시작일부터 최대 {MAX_DAYS}일까지만 집계합니다.
        </div>
      )}

      <ReportsClient rows={rows} from={fromISO} to={toISO} todayISO={todayISO} standardWorkHours={standardWorkHours} exportBase={exportBase} />

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.6 }}>
        실근무 = (퇴근−출근) − 외출. 근무 중인 기록은 현재 시각까지로 계산됩니다.
        초과근무 = 하루 실근무가 [설정 → 기준 일 근무시간]({standardWorkHours}시간)을 넘은 날의 초과분 합계입니다.
        엑셀 내보내기는 날짜별 상세(출근·퇴근·근무형태)를 담아 법정 근로기록 증빙에 쓸 수 있습니다.
      </div>
    </AppShell>
  );
}
