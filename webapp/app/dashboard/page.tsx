// 관리자 대시보드 — 오늘 우리 회사 직원들의 출퇴근 현황을 한눈에 본다. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { workedMinutes, formatMinutes, isLate, isEarlyLeave, openSessionSince } from "@/lib/worktime";
import { weekStartMonday, weeklyLevel, cappedEnd } from "@/lib/overtime";
import { effectiveWorkDays, isEffectiveWorkDay } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { leaveSuppressesLate, leaveSuppressesEarly } from "@/lib/leave";
import { loadShiftContext } from "@/lib/shift-server";
import { resolveShift, isLateByShift, isEarlyLeaveByShift } from "@/lib/shift";
import { toISODate } from "@/lib/period";
import { countUncheckedAnomalies } from "@/lib/anomaly";
import { purgeWorkRecordsDaily } from "@/lib/work-record-retention";
import { trialStatus, trialLastDay, formatKoreanDate } from "@/lib/trial";
import { getServiceAccess } from "@/lib/service-access";
import { readKispgConfig } from "@/lib/kispg-config";
import { loadAwayDays } from "@/lib/away-server";
import { ownerRecoveryState } from "@/lib/owner-recovery";
import { smsConfigured } from "@/lib/sms";
import { DashboardCalendar } from "./DashboardCalendar";
import { LatestNoticeModal } from "./LatestNoticeModal";
import type { DayData } from "@/app/schedule/ScheduleCalendar";
import { Icon } from "@/app/components/Icon";

export default async function DashboardPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.mustChangePassword) redirect("/change-password");
  if (me.role !== "admin") redirect("/attendance");

  // 보관기간(3년)이 지난 근로기록 파기 — 하루 1회만 실제로 돈다. 관리자가 매일 여는 화면이라 여기에 매단다.
  //  · after() = 화면을 다 보낸 뒤 실행 → 삭제가 오래 걸려도 대시보드가 늦게 뜨지 않는다(PC관리 화면과 같은 방식).
  after(() => purgeWorkRecordsDaily());

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const todays = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: startOfToday } },
    // 🔴 [검수 P-5] 대시보드가 쓰는 직원 항목만(비밀번호 해시 등 카드 전체 적재 방지).
    include: {
      user: { select: { name: true, workDays: true, shiftGroupId: true } },
      breaks: true,
    },
    orderBy: { clockIn: "asc" },
  });
  // 직원 목록(근무요일·미출근 계산용) — 재직중(퇴사 안 한) 사람만.
  //  · 2026-07-27: 예전엔 role="employee"만 세어 **관리자의 출퇴근이 현황에서 통째로 빠졌다**.
  //    관리자도 근로자이므로 포함하고, 사람이 아닌 회사 계정만 뺀다(isOwner).
  const employees = await prisma.user.findMany({
    where: { companyId: me.companyId, isOwner: false, deactivatedAt: null },
    select: { id: true, name: true, workDays: true, shiftGroupId: true },
  });
  const employeeCount = employees.length;

  // 근무기준(지각 판정용) + 회사 기본 근무요일 + 이상접속 감지 기준(6단계 — 조회를 늘리지 않고 같이 가져온다)
  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: {
      createdAt: true, // 가입 시각 = 무료 체험 시작(lib/trial.ts). 별도 칸을 두지 않는다.
      trialLastDate: true, // 운영자가 정한 무료 이용 마지막 날(없으면 가입일+30일)
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

  // 오늘 출장·재택을 승인받은 직원(2026-11-21 사장님 결정 C안).
  //  · 이들을 [미출근]에 섞어 두면 관리자가 "허가해 준 사람"을 매일 미출근으로 보게 된다.
  //  · 그렇다고 조용히 빼 버리면 **승인받고 출퇴근을 누르지 않은 사실**이 아무 데도 안 보인다 →
  //    리포트에서만 '출장 (승인 · 출퇴근 미기록)'으로 뒤늦게 드러난다.
  //    그래서 **따로 떼어 한 줄로 보여 준다** — 그날 안에 직원에게 눌러 달라고 할 수 있게.
  const tomorrowMidnight = new Date(startOfToday.getTime() + 86400000);
  const awayTodayIds = new Set((await loadAwayDays(me.companyId, startOfToday, tomorrowMidnight)).keys());

  // 오늘 미출근 = 오늘이 근무일인데 아직 출근 기록이 없고, 휴가도 아니고, 출장·재택 승인도 아닌 직원
  const clockedInIds = new Set(todays.map((r) => r.userId));
  const workingTodayOf = (e: { id: string; workDays: string | null; shiftGroupId: string | null }) => {
    // 근무요일 + 쉬는날(공휴일·회사휴무일) 제외는 공통. 교대제는 추가로 오늘 조 배정(≠휴무)까지 있어야 근무예정.
    const workday = isEffectiveWorkDay(now, effectiveWorkDays(e.workDays, company?.workDays), offDays);
    return shiftCtx ? workday && resolveShift(shiftCtx, e.id, e.shiftGroupId, todayISO) !== null : workday;
  };
  const notClockedIn = employees.filter((e) => workingTodayOf(e) && !clockedInIds.has(e.id) && !onLeaveTodayIds.has(e.id));
  const absentNames = notClockedIn.filter((e) => !awayTodayIds.has(e.id)).map((e) => e.name);
  const absentCount = absentNames.length;
  // 출장·재택을 승인받았는데 아직 출퇴근을 누르지 않은 사람
  const awayPendingNames = notClockedIn.filter((e) => awayTodayIds.has(e.id)).map((e) => e.name);

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
        include: { user: { select: { name: true, isOwner: true, deactivatedAt: true } }, breaks: true },
      });
      // 직원별 이번 주 실근무 합계(분). 진행 중 기록은 workedMinutes가 now까지 계산.
      const weekMinByUser = new Map<string, { name: string; minutes: number }>();
      for (const r of weekRecords) {
        // 퇴사자·회사 계정 제외(근로자 대상).
        //  · 2026-07-27: 예전엔 `role !== "employee"`라 **관리자가 주 60시간을 일해도 경보가 안 떴다**
        //    (같은 화면 위쪽에서는 관리자를 근로자로 세면서 여기만 뺐다 — 검수 치명 5).
        //    주 52시간은 법정 상한이라 관리자도 대상이다. 사람이 아닌 회사 계정만 뺀다.
        if (r.user.deactivatedAt || r.user.isOwner) continue;
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

  // 승인 대기 건수 7종 + 최신 공지(오늘 알림 카드용).
  // 서로 아무 관계가 없는 조회라 **한꺼번에 물어본다**(P-3) — 예전엔 하나씩 차례로 기다려
  // 관리자가 가장 자주 여는 이 화면의 지연이 8번 누적됐다. 숫자·표시는 그대로다.
  // ⚠️ where 조건을 변수로 빼지 않고 각 쿼리에 그대로 적는다(검수 중간 8).
  //    변수로 빼면 TypeScript의 "이 표에 없는 칸" 검사가 꺼져서, 나중에 어느 표의 companyId 칸이
  //    바뀌어도 오류 없이 통과하고 **회사 격리가 조용히 풀린다**(대기 건수가 전 회사 합계로 나온다).
  const cid = me.companyId;
  const [
    pendingLeaveCount,
    pendingResetCount,
    pendingCorrectionCount,
    pendingOutingCount,
    pendingRemoteCount,
    pendingOvertimeCount,
    pendingTripCount,
    latestNotice,
  ] = await Promise.all([
    prisma.leaveRequest.count({ where: { companyId: cid, status: "pending" } }),
    prisma.passwordResetRequest.count({ where: { companyId: cid, status: "pending" } }),
    prisma.attendanceCorrection.count({ where: { companyId: cid, status: "pending" } }),
    prisma.outingRequest.count({ where: { companyId: cid, status: "pending" } }),
    prisma.remoteWorkRequest.count({ where: { companyId: cid, status: "pending" } }),
    prisma.overtimeRequest.count({ where: { companyId: cid, status: "pending" } }),
    prisma.businessTripRequest.count({ where: { companyId: cid, status: "pending" } }),
    prisma.announcement.findFirst({
      where: { companyId: me.companyId },
      orderBy: { createdAt: "desc" },
      select: { title: true, body: true, authorName: true, createdAt: true, noticeDate: true },
    }),
  ]);

  // ── 미퇴근(퇴근을 안 찍고 넘어간 기록) — 2026-08-23 사장님 지시 ──────────────
  //  왜 필요한가: 직원이 퇴근 버튼을 잊으면 그 기록이 계속 열려 있는데, 지금까지 **관리자에게
  //    알려 주는 곳이 한 군데도 없었다.** 직원 [출퇴근] 화면에만 안내가 뜨는데, 퇴근을 안 찍은
  //    직원은 그날 다시 접속하지 않으므로 **다음 날 출근할 때야** 본다. 그사이 아무도 모른다.
  //    고치는 길은 직원이 [근태 정정]을 신청하고 관리자가 승인하는 것뿐이라, 관리자가 먼저 알아야 한다.
  //
  //  ⚠️ **자동으로 퇴근 시각을 채우지 않는다.** 실제 퇴근 시각은 본인만 안다 —
  //     시스템이 자정으로 찍어 버리면 없는 근로기록을 만들어 내는 것이고, 그 기록은 3년 보존 대상이다.
  //     근무시간 계산에서만 출근일 자정으로 잘라 부풀지 않게 한다(lib/worktime.ts effectiveEnd).
  //
  //  ⚠️ **재직 중인 직원만 센다.** 퇴사자의 미퇴근은 복직 → 본인 정정 → 재퇴사로만 고칠 수 있어
  //     (app/employees/[id]/EmployeeStatusActions.tsx 참고) 여기 넣으면 **영영 사라지지 않는 알림**이 된다.
  //     지워지지 않는 알림은 관리자가 곧 무시하게 되고, 그러면 이 칸 전체가 무의미해진다.
  //  ⚠️ 기준(openSessionSince)은 "지금 근무 중"을 가르는 것과 **같은 함수**다. 야간 교대(밤 10시 출근)를
  //     미퇴근으로 잘못 세지 않으려면 반드시 이 함수를 써야 한다. 24시간으로 직접 계산하지 말 것.
  const staleOpen = await prisma.attendance.findMany({
    where: {
      companyId: cid,
      clockOut: null,
      clockIn: { lt: openSessionSince() },
      user: { deactivatedAt: null, isOwner: false },
    },
    orderBy: { clockIn: "asc" },
    select: { clockIn: true, user: { select: { name: true } } },
  });
  const staleCount = staleOpen.length;
  // 이름은 중복 없이(같은 사람이 여러 날 빠뜨렸을 수 있다), 화면이 길어지지 않게 앞 3명만.
  const staleNames = [...new Set(staleOpen.map((r) => r.user.name))];
  const staleLabel = staleNames.slice(0, 3).join(", ") + (staleNames.length > 3 ? ` 외 ${staleNames.length - 3}명` : "");
  // 누르면 그 기록이 보이는 기간으로 [근태현황]을 연다(가장 오래된 미퇴근 날 ~ 오늘).
  //  ※ 근태현황은 시작일부터 최대 92일까지만 표시하지만, 시작일이 가장 오래된 날이라 그 건은 항상 보인다.
  const staleFrom = staleCount ? toISODate(staleOpen[0].clockIn) : "";
  const staleHref = staleCount ? `/records?from=${staleFrom}&to=${toISODate(new Date())}` : "/records";

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
      // 같은 화면 안에서도 기준이 달라지지 않게 상한을 함께 적용(검수 C-6).
      ? Math.round(todays.reduce((sum, r) => sum + workedMinutes(r, cappedEnd(r.clockIn, r.clockOut, now)), 0) / todays.length)
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

  // ⚠️ 사용 안내서는 **왼쪽 메뉴 [도움말]**(app/help)로 옮겼다 (사장님 지시 2026-11-21).
  //    대시보드는 매일 보는 화면이고 안내서는 처음 며칠만 필요해, 여기 상시로 둘 자리가 아니었다.

  // ── 무료 체험 남은 기간 띠 (사장님 지시 2026-08-09) ─────────────────────
  //  · 이 화면은 관리자 전용이라(위 role 검사) **직원에게는 보이지 않는다.**
  //  · ⚠️ 지금은 **알리기만 한다.** 만료돼도 아무 기능도 막지 않는다 — 결제 수단이 아직 없어서,
  //    막으면 고객이 돈을 낼 방법도 없이 회사 근태가 멈춘다. 차단은 결제 화면과 한 세트로 만든다(lib/trial.ts).
  //  · company가 없으면(있을 수 없지만 select 결과가 null일 수 있는 타입) 띠를 그리지 않는다.
  //  · 운영자가 회사별 마지막 날(trialLastDate)을 정했으면 그 날짜 기준(2026-11-18, 문구도 기간 길이와 무관하게 바꿈 — 사장님 확정).
  //  · 2026-11-23 결제 5단계: 무료 기간만이 아니라 **이용 상태**(무료·결제 기간, 곧 끝남, 유예, 막힘)로 띄운다(lib/service-access.ts).
  //    결제한 회사에 "무료 기간이 끝났습니다"가 뜨던 것(2단계 뒤)도 함께 고쳤다. 결제 기간이 넉넉하면 띠를 띄우지 않는다.
  const trial = company ? trialStatus(company.createdAt, new Date(), company.trialLastDate) : null;
  let access: Awaited<ReturnType<typeof getServiceAccess>> = null;
  let autoPayOn = false;
  try {
    access = await getServiceAccess(me.companyId);
    autoPayOn = (await prisma.pgBillingKey.count({ where: { companyId: me.companyId, status: "active" } })) > 0;
  } catch (e) {
    console.warn("[dashboard] 이용 상태 확인 실패(띠 생략):", e instanceof Error ? e.name : "unknown");
  }
  const inTrial = !!trial && !trial.expired && (!access || access.kind === "demo" || access.kind === "unknown" || access.usableUntil.getTime() <= trial.endsAt.getTime());
  // 카드 결제를 받을 수 있는가 — 차단이 꺼져 있어도 결제는 될 수 있다(그때 "결제 안내 준비 중"이라고 쓰지 않는다, 검수 경미 2).
  const payReady = !!readKispgConfig().normal;
  const band: { tone: { bg: string; border: string; fg: string }; body: React.ReactNode; pay: boolean } | null = (() => {
    const red = { bg: "#FEF2F2", border: "#FECACA", fg: "#991B1B" };
    const orange = { bg: "#FFF7ED", border: "#FED7AA", fg: "#9A3412" };
    const blue = { bg: "#EFF6FF", border: "#BFDBFE", fg: "#1E40AF" };
    if (!access || access.kind === "demo" || access.kind === "unknown") return null;
    const lastDay = formatKoreanDate(trialLastDay(access.usableUntil));
    const what = inTrial ? "무료 이용 기간" : "이용 기간";
    if (access.kind === "blocked") {
      return {
        tone: red, pay: true,
        body: <><strong>이용 기간이 {lastDay}에 끝나 직원의 새 출근·외출 기록이 멈췄습니다.</strong>{" 결제하시면 바로 풀립니다. 관리자 기능과 근로기록 조회·엑셀은 그대로 쓰실 수 있습니다. "}</>,
      };
    }
    if (access.kind === "grace") {
      if (access.hold === "payment_pending") {
        // 막는 날이 지났지만 확인 중인 결제가 있어 열어 둔다(lib/service-access ④ — 검수 치명 1).
        return { tone: orange, pay: true, body: <><strong>{what}이 {lastDay}에 끝났습니다.</strong>{" 결제를 확인하고 있어 직원 출근은 막지 않고 있습니다. 결제 내역에서 결과를 확인해 주세요. "}</> };
      }
      if (access.hold === "card_unavailable") {
        return { tone: orange, pay: false, body: <><strong>{what}이 {lastDay}에 끝났습니다.</strong>{" 카드로 결제할 수 없는 규모라 고객센터에서 따로 안내드립니다. 그동안 직원 출근은 막지 않습니다."}</> };
      }
      return access.blockAt
        ? {
            tone: red, pay: true,
            body: <><strong>{what}이 {lastDay}에 끝났습니다.</strong>{` ${formatKoreanDate(access.blockAt)}부터 직원의 새 출근·외출 기록이 멈춥니다(퇴근·관리자 기능·기록 조회는 그대로). `}</>,
          }
        : payReady
          ? {
              // 차단은 아직 꺼져 있지만 결제는 된다.
              tone: red, pay: true,
              body: <><strong>{what}이 끝났습니다.</strong>{" 계속 이용하시려면 결제해 주세요(지금은 직원 출근을 막지 않습니다). "}</>,
            }
          : {
              // 결제 개시 전 — 아무것도 막지 않는다. 예전 문구 그대로.
              tone: red, pay: false,
              body: <><strong>{what}이 끝났습니다.</strong>{" 결제 안내를 준비 중이며, 그때까지는 그대로 사용하실 수 있습니다."}</>,
            };
    }
    if (access.kind === "ending") {
      // 자동결제를 쓰는 회사는 결제일에 자동으로 결제되므로 "미리 결제하라"고 재촉하지 않는다(검수 경미 1).
      const autoOn = autoPayOn;
      return {
        tone: orange, pay: payReady && !autoOn,
        body: <><strong>{`${what}: ${lastDay}까지`}</strong>{` (${access.daysLeft}일 남음)`}{
          autoOn
            ? " — 자동결제로 결제될 예정입니다."
            : access.blockAt
              ? ` — 결제가 없으면 ${formatKoreanDate(access.blockAt)}부터 직원의 새 출근이 멈춥니다. 결제나 자동결제를 미리 해 두세요. `
              : payReady ? " — 계속 이용하시려면 결제해 주세요. " : ""
        }</>,
      };
    }
    // 넉넉함 — 무료 기간 중일 때만 알린다(결제 기간이 넉넉하면 띠를 띄우지 않는다).
    if (!inTrial || !trial) return null;
    return { tone: blue, pay: false, body: <><strong>{`무료 이용 기간: ${lastDay}까지`}</strong>{` (${trial.daysLeft}일 남음)`}</> };
  })();

  // ── 회사 계정 복구 준비 안내 (2026-11-21) ─────────────────────────────────
  //  · 왜 여기에: 회사 계정은 평소 잘 안 쓰는 계정이라 [계정 설정]에만 두면 아무도 번호를 확인하지 않는다.
  //    그러면 복구 기능이 있어도 정작 필요한 날 쓸 수 없다(lib/owner-recovery.ts 머리말의 점검 항목).
  //  · 관리자 모두에게 보인다 — 회사 계정이 아닌 관리자는 직접 고칠 수 없으니 "회사 계정으로 확인하라"고만 안내한다.
  //  · 기능이 꺼져 있거나(disabled) 72시간 대기(locked) 중이거나 **문자 발송이 연결되지 않았으면** 띄우지 않는다
  //    — 확인 문자를 보낼 수 없으니 할 수 있는 일이 없다(시범 기간 운영 서버는 문자가 꺼져 있다).
  //  · 부가기능이라 실패해도 대시보드는 그대로 뜬다.
  let ownerRecoveryTodo = false;
  try {
    const owner = await prisma.user.findFirst({
      where: { companyId: me.companyId, isOwner: true, deactivatedAt: null },
      select: { phone: true, phoneChangedAt: true, phoneVerifiedAt: true, phoneVerifiedNumber: true },
    });
    if (owner && smsConfigured()) {
      const st = ownerRecoveryState(owner);
      ownerRecoveryTodo = !st.ready && (st.reason === "no_phone" || st.reason === "not_mobile" || st.reason === "not_verified");
    }
  } catch (e) {
    console.warn("[dashboard] 회사 계정 복구 상태 확인 실패(안내 생략):", e);
  }

  return (
    <AppShell user={me} active="dashboard" title="대시보드" subtitle={me.company.name} right={datePill}>
      {band && (
        <div
          role="status"
          style={{
            marginBottom: 16, padding: "12px 16px", borderRadius: 10,
            background: band.tone.bg, border: `1px solid ${band.tone.border}`, color: band.tone.fg,
            fontSize: 14, lineHeight: 1.6, wordBreak: "keep-all", overflowWrap: "break-word",
          }}
        >
          {band.body}
          {band.pay ? (
            <Link href="/subscription" style={{ color: band.tone.fg, fontWeight: 700, textDecoration: "underline" }}>
              구독·요금에서 결제하기
            </Link>
          ) : null}
        </div>
      )}
      {ownerRecoveryTodo && (
        <div
          role="status"
          style={{
            marginBottom: 16, padding: "12px 16px", borderRadius: 10,
            background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E",
            fontSize: 14, lineHeight: 1.6, wordBreak: "keep-all", overflowWrap: "break-word",
          }}
        >
          <strong>회사 계정의 복구용 휴대폰 번호를 확인해 주세요.</strong>
          {me.isOwner ? (
            <>
              {" 확인해 두어야 비밀번호를 잊었을 때 문자로 직접 되찾을 수 있습니다. "}
              <Link href="/account" style={{ color: "#92400E", fontWeight: 700, textDecoration: "underline" }}>
                계정 설정에서 확인하기
              </Link>
            </>
          ) : (
            " 회사 계정으로 로그인해 [계정 설정]에서 확인해 두어야, 회사 계정 비밀번호를 잊었을 때 되찾을 수 있습니다."
          )}
        </div>
      )}
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
              {/* 출장·재택 승인인데 출퇴근 미기록 (사장님 결정 2026-11-21 C안) — 있을 때만.
                  🔴 이 사람들은 위 [미출근]에서 빠져 있다. 여기 없으면 "허가해 줬는데 안 누른 것"을
                     그날 안에 알 방법이 없고, 월말 리포트에서야 드러난다(그때는 고치기 어렵다). */}
              {awayPendingNames.length > 0 && (
                <div style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, wordBreak: "keep-all" }}>출장·재택 승인</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#0F766E", whiteSpace: "nowrap" }}>{awayPendingNames.length}명</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4, lineHeight: 1.5, wordBreak: "keep-all" }}>
                    {`${awayPendingNames.join(", ")} — 아직 출퇴근을 누르지 않았습니다(결근으로 세지 않습니다)`}
                  </div>
                </div>
              )}
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
              {/* 미퇴근 (있을 때만) — 2026-08-23 신설. 위 조회부 주석에 왜·무엇을 세는지 적어 뒀다.
                     ⚠️ 0일 때는 줄을 아예 만들지 않는다. 매일 "미퇴근 0명"이 보이면 관리자가 곧 눈으로 걸러
                        읽지 않게 되고, 정작 1명이 생겼을 때도 못 본다(위 미출근·지각·조퇴는 매일 바뀌는
                        값이라 항상 두지만, 이건 평소에 없는 것이 정상이다).
                     ⚠️ 아래 [승인 대기 휴가]는 **항상 있는 줄**이라, 여기 borderBottom은 고정으로 둔다
                        (다른 조건부 줄들처럼 뒤 항목을 따라 계산하지 않아도 된다). */}
              {staleCount > 0 && (
                <Link href={staleHref} style={{ padding: "12px 18px", borderBottom: "1px solid #F3F4F6", textDecoration: "none", color: "var(--text)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>
                      <Icon name="clock" size={14} style={{ marginRight: 5 }} />미퇴근
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{staleCount}건</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 4, lineHeight: 1.5, wordBreak: "keep-all" }}>
                    {staleLabel} — 퇴근 기록이 없습니다. [근태 정정]으로 바로잡아 주세요.
                  </div>
                </Link>
              )}
              {/* 승인 대기 휴가 */}
              <Link href="/leave/approvals" style={{ padding: "12px 18px", borderBottom: (pendingResetCount > 0 || pendingCorrectionCount > 0 || pendingOutingCount > 0 || pendingRemoteCount > 0 || pendingOvertimeCount > 0 || pendingTripCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>승인 대기 휴가</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: pendingLeaveCount > 0 ? "var(--primary)" : "var(--text-sub)" }}>{pendingLeaveCount}건</span>
              </Link>
              {/* 비밀번호 재설정 요청 (있을 때만) */}
              {pendingResetCount > 0 && (
                <Link href="/employees" style={{ padding: "12px 18px", borderBottom: (pendingCorrectionCount > 0 || pendingOutingCount > 0 || pendingRemoteCount > 0 || pendingOvertimeCount > 0 || pendingTripCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}><Icon name="key" size={14} style={{ marginRight: 5 }} />비밀번호 재설정 요청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{pendingResetCount}건</span>
                </Link>
              )}
              {/* 근태 정정 요청 (있을 때만) */}
              {pendingCorrectionCount > 0 && (
                <Link href="/corrections/approvals" style={{ padding: "12px 18px", borderBottom: (pendingOutingCount > 0 || pendingRemoteCount > 0 || pendingOvertimeCount > 0 || pendingTripCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}><Icon name="edit" size={14} style={{ marginRight: 5 }} />근태 정정 요청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingCorrectionCount}건</span>
                </Link>
              )}
              {/* 외출/외근 신청 (있을 때만) */}
              {pendingOutingCount > 0 && (
                <Link href="/outing/approvals" style={{ padding: "12px 18px", borderBottom: (pendingRemoteCount > 0 || pendingOvertimeCount > 0 || pendingTripCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}><Icon name="exit" size={14} style={{ marginRight: 5 }} />외출/외근 신청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingOutingCount}건</span>
                </Link>
              )}
              {/* 재택근무 신청 (있을 때만) */}
              {pendingRemoteCount > 0 && (
                <Link href="/remote/approvals" style={{ padding: "12px 18px", borderBottom: (pendingOvertimeCount > 0 || pendingTripCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}><Icon name="home" size={14} style={{ marginRight: 5 }} />재택근무 신청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingRemoteCount}건</span>
                </Link>
              )}
              {/* 초과근무 신청 (있을 때만) */}
              {pendingOvertimeCount > 0 && (
                <Link href="/overtime/approvals" style={{ padding: "12px 18px", borderBottom: (pendingTripCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}><Icon name="moon" size={14} style={{ marginRight: 5 }} />초과근무 신청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingOvertimeCount}건</span>
                </Link>
              )}
              {/* 출장 신청 (있을 때만) */}
              {pendingTripCount > 0 && (
                <Link href="/trip/approvals" style={{ padding: "12px 18px", borderBottom: latestNotice ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}><Icon name="plane" size={14} style={{ marginRight: 5 }} />출장 신청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingTripCount}건</span>
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
