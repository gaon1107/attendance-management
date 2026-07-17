// 근태 현황 조회(전체) — 관리자 전용. 시작~종료 날짜(커스텀 달력)로 기간을 정하고, 통합검색으로 목록을 거른다.
// 서버는 기간 데이터만 계산해 넘기고, 표·검색·달력은 RecordsClient(클라이언트)가 담당한다.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { RecordsClient, type RecordRow } from "./RecordsClient";
import { workedMinutes, formatMinutes, isLate, isEarlyLeave } from "@/lib/worktime";
import { parseAnchor, toISODate } from "@/lib/period";
import { workModeLabel, locationLabel, hhmm, monthDayDow } from "@/lib/labels";
import { effectiveWorkDays, isEffectiveWorkDay } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { leaveTypeLabel, leaveSuppressesLate, leaveSuppressesEarly } from "@/lib/leave";
import { after } from "next/server";
import { purgeExpiredPhotos } from "@/lib/clock-photo";

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 출퇴근 사진 90일 자동 파기의 정기 트리거 — 관리자가 근태 현황을 열 때(하루 1회만 실제 동작),
  // 화면 응답을 보낸 뒤(after) 실행되어 조회 속도에 영향 없음.
  after(() => purgeExpiredPhotos());

  const sp = await searchParams;
  // 기본 기간: 오늘 하루. from/to는 "YYYY-MM-DD"(달력 값)만 허용 — 이상값은 오늘로 대체(URL 조작·오타 방어).
  const todayISO = toISODate(new Date());
  const normISO = (s: string | undefined): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T00:00:00");
      if (!Number.isNaN(d.getTime())) return s;
    }
    return todayISO;
  };
  const fromISO = normISO(sp.from);
  let toISO = normISO(sp.to);
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

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, workEndTime: true, lateGraceMin: true, workDays: true, holidayAutoOn: true },
  });

  // 조회 기간의 쉬는 날(공휴일·회사휴무일) 집합 — 지각·결근 판정에서 제외한다.
  const offDays = await loadOffDays(me.companyId, company?.holidayAutoOn ?? true, start, end);

  const records = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true, clockPhotos: { select: { livenessStatus: true } } },
    orderBy: { clockIn: "asc" }, // 오래된 것이 위로(시간 흐름 순)
  });

  const hasRule = !!company?.workStartTime;
  const hasEndRule = !!company?.workEndTime;

  // 기간에 걸치는 "승인된" 반차/조퇴/휴가 → (직원|날짜)별 종류맵. 그날 지각·조퇴 자동판정을 면제하는 데 쓴다.
  const approvedLeaves = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
    select: { userId: true, type: true, startDate: true, endDate: true },
  });
  const leaveByUserDate = new Map<string, string>(); // "userId|ISO" → 종류 key
  for (const lv of approvedLeaves) {
    const cur = new Date(lv.startDate.getFullYear(), lv.startDate.getMonth(), lv.startDate.getDate());
    const last = new Date(lv.endDate.getFullYear(), lv.endDate.getMonth(), lv.endDate.getDate());
    while (cur <= last) {
      leaveByUserDate.set(`${lv.userId}|${toISODate(cur)}`, lv.type);
      cur.setDate(cur.getDate() + 1);
    }
  }

  // 각 기록을 화면 표시값(직렬화 가능한 순수 객체)으로 미리 계산 → 통합검색은 "화면에 보이는 모든 컬럼"의 글자로 판단.
  const rows: RecordRow[] = records.map((r) => {
    const onWorkDay = isEffectiveWorkDay(r.clockIn, effectiveWorkDays(r.user.workDays, company?.workDays), offDays);
    const holiday = !onWorkDay;
    let late = onWorkDay ? isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0) : null;
    let early = onWorkDay ? isEarlyLeave(r.clockOut, company?.workEndTime ?? null) : null;
    // 승인된 반차/조퇴가 있으면 그날 지각·조퇴 면제 + 승인 라벨 표기.
    const lt = leaveByUserDate.get(`${r.userId}|${toISODate(r.clockIn)}`);
    if (lt && leaveSuppressesLate(lt)) late = null;
    if (lt && leaveSuppressesEarly(lt)) early = null;
    const approvedLeave = lt ? leaveTypeLabel(lt) : null;
    const suspect = r.clockPhotos.some((p) => p.livenessStatus === "suspect");
    const review = !suspect && r.clockPhotos.some((p) => p.livenessStatus === "error");
    const dateText = monthDayDow(r.clockIn);
    const dateISO = toISODate(r.clockIn); // 이름 클릭 시 그 줄의 날짜가 속한 달로 정확히 이동시키기 위함
    const workMode = workModeLabel(r.workMode);
    const location = locationLabel(r.locationStatus);
    const inText = hhmm(r.clockIn);
    const outText = r.clockOut ? hhmm(r.clockOut) : "근무 중";
    // 검색·표시용 텍스트: 휴일근무 우선, 승인 반차/조퇴 라벨 + 자동 지각/조퇴, 아무 문제 없으면 정상.
    const lateText = holiday
      ? "휴일근무"
      : approvedLeave || late || early
        ? [approvedLeave ?? "", late ? "지각" : "", early ? "조퇴" : ""].filter(Boolean).join(" ")
        : late === null && early === null
          ? ""
          : "정상";
    const worked = formatMinutes(workedMinutes(r));
    const badge = suspect ? "위조 의심" : review ? "확인 필요" : "";
    // "근무 중"은 지금 이 순간 기준 — 오늘 출근했고 아직 퇴근 안 한 사람만(과거 미퇴근 기록이 부풀리지 않게)
    const isWorkingNow = !r.clockOut && toISODate(r.clockIn) === todayISO;
    return {
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      initial: r.user.name.slice(0, 1),
      dateText, dateISO, workMode, location, inText, outText,
      hasClockOut: !!r.clockOut,
      holiday, late, early, approvedLeave, worked, suspect, review, isWorkingNow,
      search: [dateText, r.user.name, workMode, location, inText, outText, lateText, worked, badge].join(" ").toLowerCase(),
    };
  });

  // 대기 중인 근태 정정 요청 수(상단 버튼 배지용)
  const pendingCorrectionCount = await prisma.attendanceCorrection.count({
    where: { companyId: me.companyId, status: "pending" },
  });

  const correctionBtn = (
    <Link
      href="/corrections/approvals"
      style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: pendingCorrectionCount > 0 ? "var(--primary)" : "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
    >
      📝 근태 정정 승인{pendingCorrectionCount > 0 ? ` ${pendingCorrectionCount}` : ""}
    </Link>
  );

  return (
    <AppShell user={me} active="records" title="근태 현황" subtitle={me.company.name} right={correctionBtn}>
      {rangeCapped && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, fontWeight: 700, color: "#B45309" }}>
          검색 기간이 너무 길어 시작일부터 최대 {MAX_DAYS}일까지만 표시합니다.
        </div>
      )}
      <RecordsClient rows={rows} from={fromISO} to={toISO} hasRule={hasRule} hasEndRule={hasEndRule} todayISO={todayISO} />
    </AppShell>
  );
}
