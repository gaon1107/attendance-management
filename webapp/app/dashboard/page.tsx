// 관리자 대시보드 — 오늘 우리 회사 직원들의 출퇴근 현황을 한눈에 본다. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { workedMinutes, formatMinutes, isLate, isEarlyLeave } from "@/lib/worktime";
import { effectiveWorkDays, isEffectiveWorkDay } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
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
    select: { id: true, name: true, workDays: true },
  });
  const employeeCount = employees.length;

  // 근무기준(지각 판정용) + 회사 기본 근무요일 + 이상접속 감지 기준(6단계 — 조회를 늘리지 않고 같이 가져온다)
  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: {
      workStartTime: true, workEndTime: true, lateGraceMin: true, workDays: true, holidayAutoOn: true,
      securityCheckedAt: true,
      alertNightOn: true, alertNightStart: true, alertNightEnd: true, alertFailOn: true, alertFailCount: true,
    },
  });
  const hasRule = !!company?.workStartTime;
  const hasEndRule = !!company?.workEndTime;

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

  // 지각 = 근무일 + 기준시각 이후 출근일 때만
  const lateUserIds = new Set(
    todays
      .filter((r) => {
        const wd = effectiveWorkDays(r.user.workDays, company?.workDays);
        return isEffectiveWorkDay(r.clockIn, wd, offDays) && isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0);
      })
      .map((r) => r.userId)
  );
  const lateCount = lateUserIds.size;

  // 조퇴 = 근무일 + 퇴근기록이 있고 퇴근 기준시각보다 일찍 퇴근일 때만(근무중=미퇴근은 제외)
  const earlyUserIds = new Set(
    todays
      .filter((r) => {
        const wd = effectiveWorkDays(r.user.workDays, company?.workDays);
        return isEffectiveWorkDay(r.clockIn, wd, offDays) && isEarlyLeave(r.clockOut, company?.workEndTime ?? null);
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
      const wd = effectiveWorkDays(e.workDays, company?.workDays);
      return isEffectiveWorkDay(now, wd, offDays) && !clockedInIds.has(e.id) && !onLeaveTodayIds.has(e.id);
    })
    .map((e) => e.name);
  const absentCount = absentNames.length;

  // 지각 직원 이름(오늘 출근기록 기준)
  const lateNames = [...lateUserIds].map((id) => todays.find((r) => r.userId === id)?.user.name ?? "직원");
  // 조퇴 직원 이름(오늘 퇴근기록 기준)
  const earlyNames = [...earlyUserIds].map((id) => todays.find((r) => r.userId === id)?.user.name ?? "직원");

  // 승인 대기 휴가 건수 + 비밀번호 재설정 요청 건수 + 최신 공지(오늘 알림 카드용)
  const pendingLeaveCount = await prisma.leaveRequest.count({ where: { companyId: me.companyId, status: "pending" } });
  const pendingResetCount = await prisma.passwordResetRequest.count({ where: { companyId: me.companyId, status: "pending" } });
  const pendingCorrectionCount = await prisma.attendanceCorrection.count({ where: { companyId: me.companyId, status: "pending" } });
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
              <Link href="/leave/approvals" style={{ padding: "12px 18px", borderBottom: (pendingResetCount > 0 || pendingCorrectionCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>승인 대기 휴가</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: pendingLeaveCount > 0 ? "var(--primary)" : "var(--text-sub)" }}>{pendingLeaveCount}건</span>
              </Link>
              {/* 비밀번호 재설정 요청 (있을 때만) */}
              {pendingResetCount > 0 && (
                <Link href="/employees" style={{ padding: "12px 18px", borderBottom: (pendingCorrectionCount > 0 || latestNotice) ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>🔑 비밀번호 재설정 요청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{pendingResetCount}건</span>
                </Link>
              )}
              {/* 근태 정정 요청 (있을 때만) */}
              {pendingCorrectionCount > 0 && (
                <Link href="/corrections/approvals" style={{ padding: "12px 18px", borderBottom: latestNotice ? "1px solid #F3F4F6" : "none", textDecoration: "none", color: "var(--text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700 }}>📝 근태 정정 요청</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{pendingCorrectionCount}건</span>
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
