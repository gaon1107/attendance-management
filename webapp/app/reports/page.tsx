// 근태 리포트 (관리자 전용) — 시작~종료 날짜(커스텀 달력)로 기간을 정하고, 직원별 실근무·초과근무·결근·외출을 집계.
// 법정기록 CSV 내보내기 포함. 서버는 기간 집계만 계산해 넘기고, 표·검색·달력은 ReportsClient(클라이언트)가 담당한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { HelpNote } from "@/app/components/HelpNote";
import { ReportsClient, type ReportRow } from "./ReportsClient";
import { workedMinutes, effectiveEnd } from "@/lib/worktime";
import { parseAnchor, toISODate } from "@/lib/period";
import { effectiveWorkDays } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { leaveDateSet } from "@/lib/leave";
import { loadShiftContext } from "@/lib/shift-server";
import { loadAwayDays, awayOf } from "@/lib/away-server";
import { dayBreakdown } from "@/lib/report-days";

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
    // 🔴 [검수 P-5] 집계에 쓰는 직원 항목만 가져온다(비밀번호 해시 등 전체 적재 방지).
    include: {
      user: {
        select: {
          isOwner: true, name: true, employeeNo: true, role: true,
          workDays: true, shiftGroupId: true, hireDate: true, deactivatedAt: true,
        },
      },
      breaks: true,
    },
    orderBy: { clockIn: "asc" },
  });

  // 교대제면 결근을 조 배정 기준으로(비교대면 ctx=null → 근무요일 기준 기존 로직).
  const shiftCtx = await loadShiftContext(me.companyId, toISODate(start), toISODate(end));

  // 🔴 [검수 H-7] 재직 직원 **전체**를 집계 대상으로 삼는다.
  //   예전엔 출퇴근 기록이 있는 사람만 표에 넣어서, **기간 내내 결근한 직원이 리포트에서 통째로 사라졌다.**
  //   결근이 가장 심한 사람이 결근 집계에서 빠지는 셈이라 월 마감·급여 연동에서 놓치기 쉬웠다.
  //   (회사 계정은 사람이 아니므로 제외 — 다른 집계 화면과 같은 기준)
  //   · **기간에 걸쳐 퇴사한 사람도 대상**이다(2026-08-03). 기록이 하나도 없는 퇴사자를 빼면
  //     무단결근하다 퇴사한 직원이 또 사라지고, 엑셀·PDF(lib/report-server.ts)와 인원이 어긋난다.
  const activeEmployees = await prisma.user.findMany({
    where: { companyId: me.companyId, isOwner: false, OR: [{ deactivatedAt: null }, { deactivatedAt: { gt: start } }] },
    select: { id: true, name: true, employeeNo: true, role: true, workDays: true, shiftGroupId: true, hireDate: true, deactivatedAt: true },
    orderBy: { createdAt: "asc" },
  });

  // 직원별 집계 (+ 초과근무를 위해 날짜별 실근무 분도 모은다)
  const byUser = new Map<string, { id: string; name: string; employeeNo: string | null; role: string; minutes: number; breaks: number; days: Set<string>; workDays: string | null; shiftGroupId: string | null; dayMinutes: Map<string, number>; hireDate: Date | null; deactivatedAt: Date | null }>();
  // 먼저 재직 직원 전원을 0으로 깔아둔다 → 출근이 한 번도 없어도 표에 남아 결근이 집계된다.
  for (const e of activeEmployees) {
    byUser.set(e.id, {
      id: e.id, name: e.name, employeeNo: e.employeeNo, role: e.role,
      minutes: 0, breaks: 0, days: new Set<string>(),
      workDays: e.workDays, shiftGroupId: e.shiftGroupId, dayMinutes: new Map<string, number>(),
      hireDate: e.hireDate, deactivatedAt: e.deactivatedAt,
    });
  }
  for (const r of records) {
    // 회사 계정(사람이 아님)은 집계에서 뺀다 — 엑셀·PDF(lib/report-server.ts)와 기준을 맞춘다.
    if (r.user.isOwner) continue;
    // 재직자 목록에 없는데 기록이 있는 경우 = 기간 중 퇴사한 직원. 그 사람의 기록도 빠뜨리지 않는다.
    const cur = byUser.get(r.userId) ?? { id: r.userId, name: r.user.name, employeeNo: r.user.employeeNo, role: r.user.role, minutes: 0, breaks: 0, days: new Set<string>(), workDays: r.user.workDays, shiftGroupId: r.user.shiftGroupId, dayMinutes: new Map<string, number>(), hireDate: r.user.hireDate, deactivatedAt: r.user.deactivatedAt };
    // 퇴근을 안 찍은 기록이 수백 시간으로 부풀지 않게 상한 적용(검수 C-6 — 대시보드·초과근무 화면과 같은 기준).
    const wm = workedMinutes(r, effectiveEnd(r.clockIn, r.clockOut, now));
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
  // 🔴 [후속 검수 치명 6] 결근은 **그 사람이 실제로 재직한 기간**만 센다.
  //    입사일·퇴사일을 안 보면 7/28 입사자의 7월 리포트가 "출근 2일 · 결근 18일"이 된다.
  //    이 숫자가 월 마감·급여 연동에 쓰이므로 틀리면 급여가 잘못 깎인다.
  //  ⚠️ 판정 규칙 자체는 lib/report-days.ts로 옮겼다(2026-08-03) — 엑셀·PDF가 같은 규칙을 쓰게 하기 위함.
  //     여기서 규칙을 다시 쓰지 말 것. 규칙을 바꾸려면 그 파일 하나만 고친다.
  //  ⚠️ 승인된 출장·재택일은 결근에서 뺀다(2026-11-21). 엑셀·근로기록부와 **같은 함수**를 쓰므로
  //     이 화면의 결근 숫자도 자동으로 같아진다 — 여기서 따로 계산하지 말 것.
  const awayAll = await loadAwayDays(me.companyId, start, end);
  //  ⚠️ 결근과 **출장·재택(미기록)**을 한 번에 센다. 결근만 보여 주면 승인받고 안 누른 사람이
  //     "근무일수 0 · 결근 0"으로 보여 아무 일 없는 것처럼 읽힌다(검수 치명 3).
  function countsFor(
    userId: string,
    userWorkDays: string | null,
    shiftGroupId: string | null,
    attended: Set<string>,
    leaveDays: Set<string>,
    hireDate: Date | null,
    deactivatedAt: Date | null
  ): { absent: number; away: number } {
    const r = dayBreakdown({
      start, absLimit,
      workDays: effectiveWorkDays(userWorkDays, company?.workDays),
      offDays, shiftCtx, userId, shiftGroupId, attended, leaveDays,
      awayDays: awayOf(awayAll, userId),
      hireDate, deactivatedAt,
    });
    return { absent: r.absent.length, away: r.away.length };
  }

  // 클라이언트로 넘길 직원별 요약(직렬화 가능한 순수 객체). 검색은 이름 기준.
  const rows: ReportRow[] = [...byUser.values()]
    .map((u) => ({
      id: u.id,
      name: u.name,
      employeeNo: u.employeeNo,
      initial: u.name.slice(0, 1),
      isAdmin: u.role === "admin",
      // 이 기간 안에 이미 퇴사한 사람만 "(퇴사)"로 표시(엑셀·PDF와 같은 기준)
      resigned: !!u.deactivatedAt && u.deactivatedAt < end,
      days: u.days.size,
      minutes: u.minutes,
      overtime: overtimeMinutesOf(u.dayMinutes),
      ...(() => {
        const c = countsFor(u.id, u.workDays, u.shiftGroupId, u.days, leaveByUser.get(u.id) ?? new Set(), u.hireDate, u.deactivatedAt);
        return { absent: c.absent, away: c.away };
      })(),
      breaks: u.breaks,
      // ⚠️ 검색 대상에 "퇴사/재직"을 넣지 않는다(잠깐 넣었다가 되돌림 — 검수 4차).
      //    ① 화면 검색어 q는 그대로 엑셀·PDF로 넘어가는데 서버는 이 두 낱말을 모르니 **빈 법정문서**가 만들어졌다.
      //    ② 부분일치라 "재" 한 글자가 재직자 전원을 잡아, 이름·사번으로 좁히려는 검색이 망가졌다.
      //    퇴사자는 이름 옆 (퇴사) 표시와 엑셀 [직원별 요약]의 재직상태 칸으로 구분한다.
      search: [u.name, u.employeeNo ?? "", u.role === "admin" ? "관리자" : "직원"].join(" ").toLowerCase(),
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

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.6, wordBreak: "keep-all" }}>
        실근무 = (퇴근−출근) − 외출. 초과근무 = 하루 실근무가 <b>{standardWorkHours}시간</b>([설정 → 근무 규칙 → 기준 일 근무시간])을 넘은 날의 초과분 합계입니다.
        {/* 2026-08-23: 아래 4문단이 표 밑에 그대로 펼쳐져 있어 "개발자 메모" 같았다.
            지우면 계산 근거가 사라지므로 **접어서 보존**한다(위 한 줄이 핵심 요약). */}
        <HelpNote title="계산 기준 자세히">
          근무 중인 기록은 현재 시각까지로 계산되며, <b>퇴근을 찍지 않은 채 하루가 지난 기록은 출근일 자정까지만</b> 계산합니다(기록이 며칠씩 부풀지 않도록 — 대시보드·초과근무 화면과 같은 기준). 그런 날은 [근태 정정]으로 실제 퇴근 시각을 반영해주세요.
          <br />
          <b>이 기간에 퇴사한 직원도 함께 집계</b>합니다(이름 옆 (퇴사) 표시) — 집계 인원에는 결근만 한 직원·퇴사자도 들어가고, <b>1인 평균은 근무 기록이 있는 직원만</b>으로 나눕니다(라벨의 &quot;근무 N명 기준&quot;).
          <br />
          초과근무의 기준 시간은 [설정 → 근무 규칙 → 기준 일 근무시간]에서 회사마다 바꿀 수 있습니다.
          <br />
          엑셀 내보내기는 날짜별 상세(출근·퇴근·근무형태)를 담아 법정 근로기록 증빙에 쓸 수 있습니다.
        </HelpNote>
      </div>
    </AppShell>
  );
}
