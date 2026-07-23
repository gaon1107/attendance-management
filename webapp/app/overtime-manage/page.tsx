// 초과근무 관리(관리자) — 주 단위로 직원별 연장근로(주 40시간 초과분)를 모아 본다. 조회 전용.
//  · 계산 기준 = 근로기준법: 기본근무 40h / 연장근로 = 40h 초과분 / 한도 = 주 12h(40+12=52).
//  · ⚠️ [리포트] 화면의 "초과근무"는 하루 8시간 초과분 합(다른 기준)이라 숫자가 다를 수 있다 → 화면에 명시.
//  · 실근무 계산(workedMinutes)·주52 알림(weeklyLevel)은 기존 부품 그대로 재사용, 무수정.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { workedMinutes } from "@/lib/worktime";
import { weekStartMonday, cappedEnd, weeklyLevel } from "@/lib/overtime";
import { splitWeeklyWork, extraLevel, weekEndFrom, weekLabel, weekRangeLabel } from "@/lib/overtime-week";
import { toISODate } from "@/lib/period";
import { OvertimeManageClient, type OvertimeRow } from "./OvertimeManageClient";

// "YYYY-MM-DD"(그 주 아무 날) → 그 주 월요일 0시.
//  · 형식뿐 아니라 "실재하는 날짜"인지도 확인한다(2026-99-99가 2034년으로 굴러가는 롤오버 차단).
//  · 미래 주는 이번 주로 잘라낸다(URL 직접 입력 방어 — 버튼 비활성만으로는 못 막는다).
function resolveWeekStart(weekParam: string | undefined, now: Date): Date {
  const thisWeek = weekStartMonday(now);
  if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
    const [y, m, d] = weekParam.split("-").map(Number);
    const parsed = new Date(y, m - 1, d);
    const real = parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
    if (real) {
      const ws = weekStartMonday(parsed);
      return ws.getTime() > thisWeek.getTime() ? thisWeek : ws;
    }
  }
  return thisWeek;
}

function shiftWeek(weekStart: Date, days: number): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export default async function OvertimeManagePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const now = new Date();
  const weekStart = resolveWeekStart(sp.week, now);
  const weekEnd = weekEndFrom(weekStart);
  const thisWeekStart = weekStartMonday(now);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { overtimeWarnHours: true },
  });
  const warnHours = company?.overtimeWarnHours ?? 48;

  // 그 주의 출퇴근 기록(회사 격리) — 직원 정보·외출 포함(실근무 계산에 필요).
  const records = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: weekStart, lt: weekEnd } },
    include: {
      breaks: true,
      user: { select: { id: true, name: true, employeeNo: true, role: true, deactivatedAt: true, department: { select: { name: true } } } },
    },
    orderBy: { clockIn: "asc" },
  });

  // 직원별 주간 실근무 합계. 퇴근을 안 누른 기록은 cappedEnd로 자정까지만(기존 주52 알림과 같은 안전장치).
  type Acc = { id: string; name: string; employeeNo: string | null; dept: string; isAdmin: boolean; left: boolean; minutes: number; days: Set<string>; dayMinutes: Map<string, number> };
  const byUser = new Map<string, Acc>();
  for (const r of records) {
    const cur = byUser.get(r.userId) ?? {
      id: r.userId,
      name: r.user.name,
      employeeNo: r.user.employeeNo,
      dept: r.user.department?.name ?? "",
      isAdmin: r.user.role === "admin",
      left: Boolean(r.user.deactivatedAt),
      minutes: 0,
      days: new Set<string>(),
      dayMinutes: new Map<string, number>(),
    };
    const wm = workedMinutes(r, cappedEnd(r.clockIn, r.clockOut, now));
    const iso = toISODate(r.clockIn);
    cur.minutes += wm;
    cur.days.add(iso);
    cur.dayMinutes.set(iso, (cur.dayMinutes.get(iso) ?? 0) + wm); // 하루 여러 번 출퇴근이면 합산
    byUser.set(r.userId, cur);
  }

  // [보완] 연장근로는 법상 "1주 40시간 초과" ∪ "1일 8시간 초과"다. 이 표는 주 40시간 기준이라
  //   월·화·수에 12시간씩 몰아 일해도(주 36시간) 표에는 연장 0으로 보인다 — 실제로는 일 기준 연장 12시간.
  //   기준을 바꾸면 [리포트] 화면과 또 달라지므로, 표는 그대로 두고 "일 기준으로 한도를 넘는 사람"만 배너로 경고한다.
  const standardMin = Math.round((await prisma.company.findUnique({ where: { id: me.companyId }, select: { standardWorkHours: true } }))?.standardWorkHours ?? 8) * 60;
  const dailyExtraOver: string[] = []; // 주40 기준으론 한도 미만인데 일 기준으론 12시간을 넘는 직원
  for (const u of byUser.values()) {
    let dailyExtra = 0;
    for (const dm of u.dayMinutes.values()) dailyExtra += Math.max(0, dm - standardMin);
    const weeklyExtra = Math.max(0, u.minutes - 40 * 60);
    if (dailyExtra >= 12 * 60 && weeklyExtra < 12 * 60) dailyExtraOver.push(u.name);
  }

  const rows: OvertimeRow[] = [...byUser.values()]
    .map((u) => {
      const { base, extra, ratio } = splitWeeklyWork(u.minutes);
      return {
        id: u.id,
        name: u.name,
        employeeNo: u.employeeNo,
        initial: u.name.slice(0, 1),
        dept: u.dept,
        isAdmin: u.isAdmin,
        left: u.left,
        days: u.days.size,
        total: u.minutes,
        base,
        extra,
        ratioPercent: Math.round(ratio * 100),
        level: extraLevel(extra),
        weekLevel: weeklyLevel(u.minutes, warnHours), // 주 52시간 기준(대시보드 알림과 동일 판정)
        search: [u.name, u.employeeNo ?? "", u.dept, u.isAdmin ? "관리자" : "직원"].join(" ").toLowerCase(),
      };
    })
    .sort((a, b) => b.extra - a.extra || b.total - a.total);

  // 부서 필터 후보 — 기록이 있는 직원들의 부서(빈 부서는 "미배정"으로 묶어 표시).
  const depts = [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <AppShell
      user={me}
      active="overtime-manage"
      title="초과근무 관리"
      subtitle={`${me.company.name} · ${weekLabel(weekStart)} (${weekRangeLabel(weekStart)})`}
    >
      <OvertimeManageClient
        rows={rows}
        depts={depts}
        warnHours={warnHours}
        weekLabelText={`${weekLabel(weekStart)} · ${weekRangeLabel(weekStart)}`}
        dailyExtraOver={dailyExtraOver}
        standardHours={standardMin / 60}
        prevWeek={shiftWeek(weekStart, -7)}
        nextWeek={shiftWeek(weekStart, 7)}
        thisWeek={toISODate(thisWeekStart)}
        isThisWeek={weekStart.getTime() === thisWeekStart.getTime()}
        isFutureBlocked={weekStart.getTime() >= thisWeekStart.getTime()}
      />
    </AppShell>
  );
}
