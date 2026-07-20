// 관리자 대시보드 — 오늘 우리 회사 직원들의 출퇴근 현황을 한눈에 본다. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { workedMinutes, formatMinutes, isLate, isEarlyLeave } from "@/lib/worktime";
import { weekStartMonday, weeklyLevel, cappedEnd } from "@/lib/overtime";
import { effectiveWorkDays, isEffectiveWorkDay } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { leaveSuppressesLate, leaveSuppressesEarly } from "@/lib/leave";
import { loadShiftContext } from "@/lib/shift-server";
import { resolveShift, isLateByShift, isEarlyLeaveByShift } from "@/lib/shift";
import { toISODate } from "@/lib/period";
import { countUncheckedAnomalies } from "@/lib/anomaly";
import { DashboardCalendar } from "./DashboardCalendar";
import { LatestNoticeModal } from "./LatestNoticeModal";
import type { DayData } from "@/app/schedule/ScheduleCalendar";

export default async function DashboardPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.mustChangePassword) redirect("/change-password");
  if (me.role !== "admin") redirect("/attendance");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const todays = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: startOfToday } },
    include: { user: true, breaks: true },
    orderBy: { clockIn: "asc" },
  });
  // 직원 목록(근무요일·미출근 계산용) — 재직중(퇴사 안 한) 직원만
  const employees = await prisma.user.findMany({
    where: { companyId: me.companyId, role: "employee", deactivatedAt: null },
    select: { id: true, name: true, workDays: true, shiftGroupId: true },
  });
  const employeeCount = employees.length;

  // 근무기준(지각 판정용) + 회사 기본 근무요일 + 이상접속 감지 기준(6단계 — 조회를 늘리지 않고 같이 가져온다)
  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: {
      workStartTime: true, workEndTime: true, lateGraceMin: true, workDays: true, holidayAutoOn: true,
      overtimeAlertOn: true, overtimeWarnHours: true,
      securityCheckedAt: true,
      alertNightOn: true, alertNightStart: true, alertNightEnd: true, alertFailOn: true, alertFailCount: true,
    },
  });
  // 교대제면 오늘 각 직원 조 기준으로 지각/조퇴/미출근 판정(비교대면 ctx=null → 기존).
  const todayISO = toISODate(startOfToday);
  const tomorrowISO = toISODate(new Date(startOfToday.getTime() + 86400000));
  const shiftCtx = await loadShiftContext(me.companyId, todayISO, tomorrowISO);
  const hasRule = shiftCtx ? true : !!company?.workStartTime;
  const hasEndRule = shiftCtx ? true : !!company?.workEndTime;

  // 오늘의 쉬는 날(공휴일·회사휴무일) 집합 — 지각·미출근·휴일근무 판정에서 제외한다.
  const offDays = await loadOffDays(me.companyId, company?.holidayAutoOn ?? true, startOfToday, startOfToday);

  // 이번 달 일정 캘린더 데이터(대시보드 카드) — 법정공휴일(전국)·회사 휴무일·회사 일정.
  const calYear = startOfToday.getFullYear();
  const calMonth = startOfToday.getMonth(); // 0-based
  const calPrefix = `${calYear}-${String(calMonth + 1).padStart(2, "0")}`;
  const [calNat, calComp, calEvents] = await Promise.all([
    prisma.holiday.findMany({ where: { date: { startsWith: calPrefix } }, select: { date: true, name: true } }),
    prisma.companyHoliday.findMany({ where: { companyId: me.companyId, date: { startsWith: calPrefix } }, select: { id: true, date: true, name: true } }),
    // 대시보드는 관리자용 → 회사 일정(userId=null)만. 직원 개인 일정은 프라이버시상 제외.
    prisma.companyEvent.findMany({ where: { companyId: me.companyId, userId: null, date: { startsWith: calPrefix } }, select: { id: true, date: true, title: true, color: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const calByDate: Record<string, DayData> = {};
  const ensureDay = (iso: string): DayData => (calByDate[iso] ??= { events: [] });
  for (const h of calNat) ensureDay(h.date).nationalHoliday = h.name;
  for (const c of calComp) ensureDay(c.date).companyHoliday = { id: c.id, name: c.name };
  // 대시보드 캘린더는 읽기전용이라 mine/삭제는 쓰지 않음. 전부 회사 일정(personal=false).
  for (const e of calEvents) ensureDay(e.date).events.push({ id: e.id, title: e.title, color: e.color, mine: false, personal: false });

  // 오늘 승인된 반차/조퇴/휴가 → 직원별 종류맵. 승인자는 지각·조퇴 자동판정에서 제외한다.
  const approvedToday = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "approved", startDate: { lte: startOfToday }, endDate: { gte: startOfToday } },
    select: { userId: true, type: true },
  });
  const leaveTypeTodayByUser = new Map<string, string>();
  for (const l of approvedToday) leaveTypeTodayByUser.set(l.userId, l.type);

  // 지각 = 근무일 + 기준시각 이후 출근일 때만. 단, 승인된 반차/휴가로 지각이 면제되는 직원은 제외.
  const lateUserIds = new Set(
    todays
      .filter((r) => {
        // 근무요일 + 쉬는날(공휴일·회사휴무일) 제외는 공통 게이트.
        const wd = effectiveWorkDays(r.user.workDays, company?.workDays);
        if (!isEffectiveWorkDay(r.clockIn, wd, offDays)) return false;
        if (shiftCtx) {
          // 교대제: 그날 조 기준(휴무면 판정 안 함), 자정 넘김 정확.
          const shift = resolveShift(shiftCtx, r.userId, r.user.shiftGroupId, toISODate(r.clockIn));
          if (!shift) return false;
          if (!isLateByShift(r.clockIn, toISODate(r.clockIn), shift, company?.lateGraceMin ?? 0)) return false;
        } else {
          if (!isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0)) return false;
        }
        const lt = leaveTypeTodayByUser.get(r.userId);
        return !(lt && leaveSuppressesLate(lt));
      })
      .map((r) => r.userId)
  );
  const lateCount = lateUserIds.size;

  // 조퇴 = 근무일 + 퇴근기록이 있고 퇴근 기준시각보다 일찍 퇴근일 때만(근무중=미퇴근은 제외).
  // 단, 승인된 오후 반차/조퇴로 면제되는 직원은 제외.
  const earlyUserIds = new Set(
    todays
      .filter((r) => {
        const wd = effectiveWorkDays(r.user.workDays, company?.workDays);
        if (!isEffectiveWorkDay(r.clockIn, wd, offDays)) return false;
        if (shiftCtx) {
          const shift = resolveShift(shiftCtx, r.userId, r.user.shiftGroupId, toISODate(r.clockIn));
          if (!shift) return false;
          if (!r.clockOut || !isEarlyLeaveByShift(r.clockOut, toISODate(r.clockIn), shift)) return false;
        } else {
          if (!isEarlyLeave(r.clockOut, company?.workEndTime ?? null)) return false;
        }
        const lt = leaveTypeTodayByUser.get(r.userId);
        return !(lt && leaveSuppressesEarly(lt));
      })
      .map((r) => r.userId)
  );
  const earlyCount = earlyUserIds.size;

  // 오늘 승인된 휴가자(연차·병가 등)는 미출근에서 제외
  const now = new Date();
  const onLeaveToday = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "approved", startDate: { lte: now }, endDate: { gte: startOfToday } },
    select: { userId: true },
  });
  const onLeaveTodayIds = new Set(onLeaveToday.map((l) => l.userId));

  // 오늘 미출근 = 오늘이 근무일인데 아직 출근 기록이 없고, 휴가도 아닌 직원
  const clockedInIds = new Set(todays.map((r) => r.userId));
  const absentNames = employees
    .filter((e) => {
      // 근무요일 + 쉬는날(공휴일·회사휴무일) 제외는 공통. 교대제는 추가로 오늘 조 배정(≠휴무)까지 있어야 근무예정.
      const workday = isEffectiveWorkDay(now, effectiveWorkDays(e.workDays, company?.workDays), offDays);
      const workingToday = shiftCtx ? workday && resolveShift(shiftCtx, e.id, e.shiftGroupId, todayISO) !== null : workday;
      return workingToday && !clockedInIds.has(e.id) && !onLeaveTodayIds.has(e.id);
    })
    .map((e) => e.name);
  const absentCount = absentNames.length;

  // 지각 직원 이름(오늘 출근기록 기준)
  const lateNames = [...lateUserIds].map((id) => todays.find((r) => r.userId === id)?.user.name ?? "직원");
  // 조퇴 직원 이름(오늘 퇴근기록 기준)
  const earlyNames = [...earlyUserIds].map((id) => todays.find((r) => r.userId === id)?.user.name ?? "직원");

  // ── 주 52시간 초과근무 알림(B-3) — 이번 주(월 00:00~현재) 실근무 합계가 위험선을 넘은 직원 ──
  // 부가기능: 꺼져 있으면 조회 자체를 건너뛴다. 실패해도 대시보드 본체엔 영향 없게 try/catch(이상접속과 동일).
  const overtimeOn = company?.overtimeAlertOn ?? true;
  const overtimeWarnHours = company?.overtimeWarnHours ?? 48;
  const otOverNames: string[] = []; // 52시간 이상(초과 — 법 위반 위험)
  const otWarnNames: string[] = []; // 경고선~52시간(근접)
  if (overtimeOn) {
    try {
      const weekStart = weekStartMonday(now);
      const weekRecords = await prisma.attendance.findMany({
        where: { companyId: me.companyId, clockIn: { gte: weekStart } },
        include: { user: { select: { name: true, role: true, deactivatedAt: true } }, breaks: true },
      });
      // 직원별 이번 주 실근무 합계(분). 진행 중 기록은 workedMinutes가 now까지 계산.
      const weekMinByUser = new Map<string, { name: string; minutes: number }>();
      for (const r of weekRecords) {
        if (r.user.deactivatedAt || r.user.role !== "employee") continue; // 퇴사자·관리자 제외(근로자 대상)
        const cur = weekMinByUser.get(r.userId) ?? { name: r.user.name, minutes: 0 };
        // 잊은 퇴근이 여러 날로 부풀어 허위 초과경보가 나지 않게 종료시각에 상한(출근일 자정)을 둔다.
        cur.minutes += workedMinutes(r, cappedEnd(r.clockIn, r.clockOut, now));
        weekMinByUser.set(r.userId, cur);
      }
      for (const { name, minutes } of weekMinByUser.values()) {
        const lv = weeklyLevel(minutes, overtimeWarnHours);
        if (lv === "over") otOverNames.push(name);
        else if (lv === "warn") otWarnNames.push(name);
      }
      otOverNames.sort(); // 표시 순서 고정(DB 반환 순서 의존 제거)
      otWarnNames.sort();
    } catch (e) {
      console.warn("[dashboard] 주52 초과근무 집계 실패(대시보드는 정상 표시):", e);
    }
  }
  const otCount = otOverNames.length + otWarnNames.length;

  // 승인 대기 휴가 건수 + 비밀번호 재설정 요청 건수 + 최신 공지(오늘 알림 카드용)
  const pendingLeaveCount = await prisma.leaveRequest.count({ where: { companyId: me.companyId, status: "pending" } });
  const pendingResetCount = await prisma.passwordResetRequest.count({ where: { companyId: me.companyId, status: "pending" } });
  const pendingCorrectionCount = await prisma.attendanceCorrection.count({ where: { companyId: me.companyId, status: "pending" } });
  const pendingOutingCount = await prisma.outingRequest.count({ where: { companyId: me.companyId, status: "pending" } });
  const pendingRemoteCount = await prisma.remoteWorkRequest.count({ where: { companyId: me.companyId, status: "pending" } });
  const pendingOvertimeCount = await prisma.overtimeRequest.count({ where: { companyId: me.companyId, status: "pending" } });
  const latestNotice = await prisma.announcement.findFirst({
    where: { companyId: me.companyId },
    orderBy: { createdAt: "desc" },
    select: { title: true, body: true, authorName: true, createdAt: true, noticeDate: true },
  });

  // 이상접속 미확인 건수(접속/보안 6단계) — 알림 화면과 **같은 함수**를 써서 두 곳 숫자가 어긋나지 않게 한다.
  // ⚠️ 이 부가 기능이 고장 나도 대시보드(본기능)는 떠야 한다 → 실패하면 0으로 두고 넘어간다.
  let alertCount = 0;
  let alertCapped = false; // 기록이 너무 많아 일부만 검사한 경우 — 숫자가 실제보다 적다("N건+"로 표시)
  if (company) {
    try {
      const r = await countUncheckedAnomalies(me.companyId, company, company.securityCheckedAt);
      alertCount = r.count;
      alertCapped = r.capped;
    } catch (e) {
      console.warn("[dashboard] 이상접속 집계 실패(대시보드는 정상 표시):", e);
    }
  }

  // 실제 데이터로만 집계 (DB에 없는 값은 만들지 않는다)
  const checkedInPeople = new Set(todays.map((r) => r.userId)).size;
  const workingNow = todays.filter((r) => !r.clockOut).length;
  const clockedOut = todays.filter((r) => r.clockOut).length;
  const onBreakNow = todays.filter((r) => !r.clockOut && r.breaks.some((b) => !b.endAt)).length;
  const avgMinutes =
    todays.length > 0
      ? Math.round(todays.reduce((sum, r) => sum + workedMinutes(r), 0) / todays.length)
      : 0;

  const todayLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const kpis = [
    { label: "등록 직원", value: `${employeeCount}`, unit: "명", color: "var(--text)" },
    { label: "오늘 출근", value: `${checkedInPeople}`, unit: "명", color: "var(--primary)" },
    { label: "현재 근무 중", value: `${workingNow}`, unit: "명", color: "var(--success)" },
    { label: "오늘 실근무 평균", value: formatMinutes(avgMinutes), unit: "", color: "var(--text)" },
  ];

  const datePill = (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 14px",
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
        fontSize: 14, fontWeight: 700, color: "var(--text-sub)", whiteSpace: "nowrap",
      }}
    >
      {todayLabel}
    </div>
  );

  return (
    <AppShell user={me} active="dashboard" title="대시보드" subtitle={me.company.name} right={datePill}>
      <div className="dash-split">
        {/* 왼쪽 */}
        <div style={{ minWidth: 0 }}>
          {/* KPI */}
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            {kpis.map((k) => (
              <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 14, whiteSpace: "nowrap" }}>{k.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
                  {k.value}
                  {k.unit && <span style={{ fontSize: 15, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* 이번 달 일정 캘린더 (기존 "오늘 출퇴근 현황" 표는 [근태현황]과 중복이라 제거 —
              오늘 요약은 상단 KPI·우측 알림에 있고, 상세 명단은 [근태현황]에서 본다) */}
          <DashboardCalendar year={calYear} month={calMonth} byDate={calByDate} />
        </div>

        {/* 오른쪽: 오늘 알림 + 실시간 근무 인원 (실제 데이터) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 오늘 알림 — 미출근·지각 명단 + 대기 휴가 + 최신 공지 (모두 실데이터) */}
          <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700 }}>오늘 알림</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {/* 이상 접속(6단계) — 있을 때만 표시. 보안 사안이라 목록 맨 위에 둔다.
                  건수는 [보안로그 → 이상 접속]에서 [확인함]을 누르면 0이 된다(같은 판정 함수를 씀). */}
              {alertCount > 0 && (
                <Link href="/security/alerts" style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>🔒 이상 접속</span>
                  {/* 잘렸으면 "+"를 붙여 정직하게 — 조용히 적은 숫자를 말하면 관리자가 다 봤다고 믿는다. */}
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{alertCount}건{alertCapped ? "+" : ""}</span>
                </Link>
              )}
              {/* 주 52시간 초과근무(B-3) — 있을 때만. 법 위반 위험(초과)·근접을 함께 표시. 상세는 [리포트]에서. */}
              {overtimeOn && otCount > 0 && (
                <Link href="/reports" style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6", textDecoration: "none", color: "var(--text)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>⏱ 주 52시간 초과근무</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: otOverNames.length > 0 ? "var(--danger)" : "var(--warning)" }}>
                      {otOverNames.length > 0 ? `초과 ${otOverNames.length}명` : ""}
                      {otOverNames.length > 0 && otWarnNames.length > 0 ? " · " : ""}
                      {otWarnNames.length > 0 ? `근접 ${otWarnNames.length}명` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4, lineHeight: 1.5 }}>
                    {otOverNames.length > 0 && <div>초과(52시간↑): {otOverNames.join(", ")}</div>}
                    {otWarnNames.length > 0 && <div>근접({overtimeWarnHours}시간↑): {otWarnNames.join(", ")}</div>}
                  </div>
                </Link>
              )}
              {/* 미출근 */}
              <Link href="/records" style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6", textDecoration: "none", color: "var(--text)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>미출근</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: absentCount > 0 ? "var(--danger)" : "var(--text-sub)" }}>{absentCount}명</span>
                </div>
                {absentCount > 0 && <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4, lineHeight: 1.5 }}>{absentNames.join(", ")}</div>}
              </Link>
              {/* 지각 */}
              <Link href="/records" style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6", textDecoration: "none", color: "var(--text)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>지각</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: hasRule && lateCount > 0 ? "var(--warning)" : "var(--text-sub)" }}>{hasRule ? `${lateCount}명` : "—"}</span>
                </div>
                {hasRule && lateCount > 0 && <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4, lineHeight: 1.5 }}>{lateNames.join(", ")}</div>}
              </Link>
              {/* 조퇴 */}
              <Link href="/records" style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6", textDecoration: "none", color: "var(--text)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>조퇴</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: hasEndRule && earlyCount > 0 ? "var(--warning)" : "var(--text-sub)" }}>{hasEndRule ? `${earlyCount}명` : "—"}</span>
                </div>
                {hasEndRule && earlyCount > 0 && <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4, lineHeight: 1.5 }}>{earlyNames.join(", ")}</div>}
              </Link>
              {/* 승인 대기 휴가 */}
              <Link href="/leave/approvals" style={{ padding: "12px 18px", borderBottom: (pendingResetCount > 0 || pendingCorrectionCount > 0 || pendingOutingCount > 0 || pendingRemoteCount > 0 || pendingOvertimeCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>승인 대기 휴가</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: pendingLeaveCount > 0 ? "var(--primary)" : "var(--text-sub)" }}>{pendingLeaveCount}건</span>
              </Link>
              {/* 비밀번호 재설정 요청 (있을 때만) */}
              {pendingResetCount > 0 && (
                <Link href="/employees" style={{ padding: "12px 18px", borderBottom: (pendingCorrectionCount > 0 || pendingOutingCount > 0 || pendingRemoteCount > 0 || pendingOvertimeCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>🔑 비밀번호 재설정 요청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{pendingResetCount}건</span>
                </Link>
              )}
              {/* 근태 정정 요청 (있을 때만) */}
              {pendingCorrectionCount > 0 && (
                <Link href="/corrections/approvals" style={{ padding: "12px 18px", borderBottom: (pendingOutingCount > 0 || pendingRemoteCount > 0 || pendingOvertimeCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>📝 근태 정정 요청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingCorrectionCount}건</span>
                </Link>
              )}
              {/* 외출/외근 신청 (있을 때만) */}
              {pendingOutingCount > 0 && (
                <Link href="/outing/approvals" style={{ padding: "12px 18px", borderBottom: (pendingRemoteCount > 0 || pendingOvertimeCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>🚶 외출/외근 신청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingOutingCount}건</span>
                </Link>
              )}
              {/* 재택근무 신청 (있을 때만) */}
              {pendingRemoteCount > 0 && (
                <Link href="/remote/approvals" style={{ padding: "12px 18px", borderBottom: (pendingOvertimeCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>🏠 재택근무 신청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingRemoteCount}건</span>
                </Link>
              )}
              {/* 초과근무 신청 (있을 때만) */}
              {pendingOvertimeCount > 0 && (
                <Link href="/overtime/approvals" style={{ padding: "12px 18px", borderBottom: latestNotice ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>🌙 초과근무 신청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingOvertimeCount}건</span>
                </Link>
              )}
              {/* 최신 공지 — 클릭 시 모달로 본문(공지 화면이 캘린더로 통합되어 페이지 이동 대신 모달) */}
              {latestNotice && (
                <LatestNoticeModal
                  notice={{
                    title: latestNotice.title,
                    body: latestNotice.body,
                    authorName: latestNotice.authorName,
                    // 캘린더·배너와 같은 "표시 날짜" 기준으로 표기(미지정이면 작성일).
                    dateLabel: (latestNotice.noticeDate ? new Date(`${latestNotice.noticeDate}T00:00:00`) : latestNotice.createdAt)
                      .toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }),
                  }}
                />
              )}
            </div>
          </section>

          <section style={{ background: "var(--primary)", borderRadius: 12, padding: "20px 22px", color: "#fff" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>실시간 근무 인원</div>
            <div style={{ fontSize: 32, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {workingNow}
              <span style={{ fontSize: 15, fontWeight: 400, color: "rgba(255,255,255,0.8)", marginLeft: 2 }}>명 근무 중</span>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.18)" }}>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>외출 중</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{onBreakNow}명</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>퇴근</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{clockedOut}명</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>오늘 출근</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{checkedInPeople}명</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
