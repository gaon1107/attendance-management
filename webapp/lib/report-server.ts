// [단일 출처] 법정 산출물(엑셀 `reports/export` · 근로기록부 PDF `reports/print`)이 쓰는 데이터 조립기.
//
// 왜 만들었나 (2026-08-03, 검수 H-7 후속):
//  · 두 산출물이 **출근 기록만** 읽어서 ①한 달 내내 결근한 직원이 통째로 빠지고 ②휴가가 전혀 안 보였다.
//    급여 정산이 이 엑셀을 쓰는데, 결근자가 없으니 화면 리포트와 서로 다른 말을 했다.
//  · 두 곳에 같은 조립 코드를 복사하면 다음에 또 어긋난다 → 여기 하나로 모은다.
//    (결근/휴가 판정 규칙 자체는 lib/report-days.ts — 리포트 **화면**도 그 규칙을 쓴다)
//
// 담는 범위: **재직 직원 전원**(회사 계정 제외) + 기간 중 기록이 있는 퇴사자.
//  · 하루 한 줄: 출근한 날 = 기록 그대로 / 출근 없이 승인휴가로 쉰 날 = "휴가" / 근무예정일인데 둘 다 없음 = "결근".
//  · 결근·휴가 줄은 **오늘 이전**까지만 만든다(오늘·미래는 아직 판정할 수 없다 — 화면 결근 집계와 같은 기준).
import { prisma } from "@/lib/db";
import { workedMinutes, effectiveEnd, isUnclosed } from "@/lib/worktime";
import { workModeLabel, locationStatusLabel } from "@/lib/location";
import { clockOutText } from "@/lib/labels";
import { toISODate } from "@/lib/period";
import { effectiveWorkDays } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { leaveDateSet, leaveLabelByDate } from "@/lib/leave";
import { loadShiftContext } from "@/lib/shift-server";
import { dayBreakdown } from "@/lib/report-days";
import { queryTerms, matchesTerms } from "@/lib/search";

export type ReportDayRow = {
  date: string; // "YYYY-MM-DD"
  kind: "work" | "leave" | "absent";
  kindLabel: string; // "출근" | "휴가 · 연차" | "결근"
  workMode: string;
  location: string;
  in: string; // "HH:MM"
  out: string; // "HH:MM"(+익일 표기) — 미퇴근/근무중이면 아래 open·unclosed로 구분
  breaks: number;
  worked: number; // 분
  open: boolean; // 퇴근 시각 없음
  unclosed: boolean; // 하루가 지나도록 퇴근이 안 찍힘 = 퇴근 누락
};

export type ReportPerson = {
  id: string;
  name: string;
  employeeNo: string | null;
  role: string;
  resigned: boolean; // 기간 중 퇴사(또는 이미 퇴사)한 사람
  rows: ReportDayRow[];
  workedDays: number; // 출근 기록이 있는 날 수
  totalWorked: number; // 실근무 합(분)
  totalBreaks: number;
  overtime: number; // 초과근무 합(분)
  absentDays: number;
  leaveDays: number;
};

function hhmm(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// 직원 검색어(q) 대상 문자열 — 화면(ReportsClient)과 같은 규칙(이름·사번·역할).
function searchTextOf(u: { name: string; employeeNo: string | null; role: string }): string {
  return [u.name, u.employeeNo ?? "", u.role === "admin" ? "관리자" : "직원"].join(" ").toLowerCase();
}

export async function buildReportBlocks(opts: {
  companyId: string;
  start: Date; // 조회 시작(자정)
  end: Date; // 조회 끝(다음날 자정, 미포함)
  q: string;
  now: Date;
  standardMin: number; // 기준 일 근무시간(분)
}): Promise<ReportPerson[]> {
  const { companyId, start, end, q, now, standardMin } = opts;

  const [company, records, employees, leaves, shiftCtx] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { workDays: true, holidayAutoOn: true } }),
    prisma.attendance.findMany({
      where: { companyId, clockIn: { gte: start, lt: end } },
      include: { user: true, breaks: true },
      orderBy: [{ clockIn: "asc" }],
    }),
    // 재직 전원(회사 계정 제외) — 출근이 하나도 없어도 대상이다(H-7의 핵심).
    prisma.user.findMany({
      where: { companyId, deactivatedAt: null, isOwner: false },
      select: { id: true, name: true, employeeNo: true, role: true, workDays: true, shiftGroupId: true, hireDate: true, deactivatedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, type: true, startDate: true, endDate: true },
    }),
    loadShiftContext(companyId, toISODate(start), toISODate(end)),
  ]);

  const offDays = await loadOffDays(companyId, company?.holidayAutoOn ?? true, start, end);

  // 직원별 휴가 날짜/라벨 (조퇴는 leaveDateSet·leaveLabelByDate에서 제외 → 결근으로 남는다)
  const leavesByUser = new Map<string, { type: string; startDate: Date; endDate: Date }[]>();
  for (const l of leaves) {
    const arr = leavesByUser.get(l.userId);
    if (arr) arr.push(l);
    else leavesByUser.set(l.userId, [l]);
  }

  type Acc = {
    id: string; name: string; employeeNo: string | null; role: string;
    workDays: string | null; shiftGroupId: string | null; hireDate: Date | null; deactivatedAt: Date | null;
    rows: ReportDayRow[]; attended: Set<string>; totalWorked: number; totalBreaks: number; dayMinutes: Map<string, number>;
  };
  const byUser = new Map<string, Acc>();
  const mk = (u: { id: string; name: string; employeeNo: string | null; role: string; workDays: string | null; shiftGroupId: string | null; hireDate: Date | null; deactivatedAt: Date | null }): Acc => ({
    ...u, rows: [], attended: new Set<string>(), totalWorked: 0, totalBreaks: 0, dayMinutes: new Map<string, number>(),
  });

  for (const e of employees) byUser.set(e.id, mk(e));

  for (const r of records) {
    // 재직자 목록에 없는데 기록이 있는 경우 = 기간 중(또는 이미) 퇴사한 직원. 그 사람의 기록도 빠뜨리지 않는다.
    const cur = byUser.get(r.userId) ?? mk({
      id: r.userId, name: r.user.name, employeeNo: r.user.employeeNo, role: r.user.role,
      workDays: r.user.workDays, shiftGroupId: r.user.shiftGroupId, hireDate: r.user.hireDate, deactivatedAt: r.user.deactivatedAt,
    });
    const iso = toISODate(r.clockIn);
    // 퇴근을 안 찍은 기록이 수백 시간으로 부풀어 법정 증빙 숫자에 들어가지 않게 상한 적용(검수 C-6).
    const wm = workedMinutes(r, effectiveEnd(r.clockIn, r.clockOut, now));
    cur.rows.push({
      date: iso,
      kind: "work",
      kindLabel: "출근",
      workMode: workModeLabel(r.workMode),
      location: r.workMode === "office" ? locationStatusLabel(r.locationStatus) : "-",
      in: hhmm(r.clockIn),
      out: r.clockOut ? clockOutText(r.clockIn, r.clockOut) : "",
      breaks: r.breaks.length,
      worked: wm,
      open: !r.clockOut,
      unclosed: isUnclosed(r.clockOut, r.clockIn, now),
    });
    cur.attended.add(iso);
    cur.totalWorked += wm;
    cur.totalBreaks += r.breaks.length;
    cur.dayMinutes.set(iso, (cur.dayMinutes.get(iso) ?? 0) + wm);
    byUser.set(r.userId, cur);
  }

  // 결근·휴가는 "오늘 이전"까지만 판정한다(화면 리포트와 같은 상한).
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const absLimit = end < startOfToday ? end : startOfToday;

  const terms = queryTerms(q);
  const out: ReportPerson[] = [];

  for (const u of byUser.values()) {
    if (terms.length && !matchesTerms(searchTextOf(u), terms)) continue;

    const mine = leavesByUser.get(u.id) ?? [];
    const leaveSet = leaveDateSet(mine);
    const labelByDate = leaveLabelByDate(mine);
    const { absent, onLeave } = dayBreakdown({
      start, absLimit,
      workDays: effectiveWorkDays(u.workDays, company?.workDays),
      offDays, shiftCtx, userId: u.id, shiftGroupId: u.shiftGroupId,
      attended: u.attended, leaveDays: leaveSet,
      hireDate: u.hireDate, deactivatedAt: u.deactivatedAt,
    });

    const blank = { workMode: "-", location: "-", in: "", out: "", breaks: 0, worked: 0, open: false, unclosed: false };
    for (const iso of onLeave) {
      u.rows.push({ date: iso, kind: "leave", kindLabel: `휴가 · ${labelByDate.get(iso) ?? "휴가"}`, ...blank });
    }
    for (const iso of absent) {
      u.rows.push({ date: iso, kind: "absent", kindLabel: "결근", ...blank });
    }
    // 날짜순(같은 날이면 출근 기록 먼저 — 반차 등으로 한 날에 두 줄이 생겨도 순서가 일정)
    u.rows.sort((a, b) => (a.date === b.date ? (a.kind === "work" ? -1 : 1) : a.date < b.date ? -1 : 1));

    let overtime = 0;
    for (const v of u.dayMinutes.values()) overtime += Math.max(0, v - standardMin);

    out.push({
      id: u.id, name: u.name, employeeNo: u.employeeNo, role: u.role,
      resigned: !!u.deactivatedAt,
      rows: u.rows,
      workedDays: u.attended.size,
      totalWorked: u.totalWorked,
      totalBreaks: u.totalBreaks,
      overtime,
      absentDays: absent.length,
      leaveDays: onLeave.length,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
