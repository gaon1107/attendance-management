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
import { leaveDateSet, leaveLabelByDate, leaveTypeLabel } from "@/lib/leave";
import { loadShiftContext } from "@/lib/shift-server";
import { dayBreakdown } from "@/lib/report-days";
import { queryTerms, matchesTerms } from "@/lib/search";

export type ReportDayRow = {
  date: string; // "YYYY-MM-DD"
  kind: "work" | "leave" | "absent";
  kindLabel: string; // "출근" | "휴가 · 연차" | "결근" | "결근 (출장 승인)" 등
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

// 반차 종류(하루의 절반). 휴가 일수를 셀 때 0.5로 센다 — 연차 차감(lib/leave.ts computeLeaveDays)과 같은 무게.
const HALF_DAY_TYPES = new Set(["half", "half_am", "half_pm"]);

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

  const [company, records, employees, leaves, pendingLeaves, trips, remotes, shiftCtx] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { workDays: true, holidayAutoOn: true } }),
    prisma.attendance.findMany({
      where: { companyId, clockIn: { gte: start, lt: end } },
      include: { user: true, breaks: true },
      orderBy: [{ clockIn: "asc" }],
    }),
    // 재직 전원(회사 계정 제외) + **기간에 걸쳐 퇴사한 사람**.
    //  · 퇴사자를 "기록이 있는 사람"으로만 끌어오면, 무단결근하다 퇴사한 직원이 또 통째로 빠진다
    //    (H-7과 정확히 같은 구멍 — 검수 M-3).
    prisma.user.findMany({
      where: { companyId, isOwner: false, OR: [{ deactivatedAt: null }, { deactivatedAt: { gt: start } }] },
      select: { id: true, name: true, employeeNo: true, role: true, workDays: true, shiftGroupId: true, hireDate: true, deactivatedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, type: true, startDate: true, endDate: true },
    }),
    // 아래 3종은 **결근 판정을 바꾸지 않는다.** 결근으로 남는 날에 "왜 그럴 수 있는지"를 덧붙이기 위해서만 읽는다
    // (법정 문서에 이유 없는 결근이 찍히는 것을 막는다 — 검수 M-4·M-5).
    prisma.leaveRequest.findMany({
      where: { companyId, status: "pending", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, type: true, startDate: true, endDate: true },
    }),
    prisma.businessTripRequest.findMany({
      where: { companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, startDate: true, endDate: true },
    }),
    prisma.remoteWorkRequest.findMany({
      where: { companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, startDate: true, endDate: true },
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

  // 결근 줄에 덧붙일 사유 후보(결근 여부 자체는 바꾸지 않는다).
  //  · 결재 대기 중인 휴가 → "휴가 결재 대기"   · 승인된 출장/재택인데 출퇴근 기록이 없음 → "출장/재택 승인"
  //  법정 문서에 아무 설명 없는 "결근"이 찍히면 노무 분쟁에서 회사에 불리하다.
  const noteByUserDate = new Map<string, string>();
  const addNote = (userId: string, s: Date, e: Date, note: string) => {
    // 조회 기간 밖은 채우지 않는다(출장은 최대 366일까지 신청 가능 — 쓸데없이 큰 맵이 된다)
    const first = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const cur = first < start ? new Date(start) : first;
    const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
    while (cur <= last && cur < end) {
      const key = `${userId}|${toISODate(cur)}`;
      if (!noteByUserDate.has(key)) noteByUserDate.set(key, note); // 먼저 잡힌 사유를 유지(휴가 대기 > 출장 > 재택)
      cur.setDate(cur.getDate() + 1);
    }
  };
  // ⚠️ 넣는 순서 = 우선순위(먼저 잡힌 사유가 남는다). **확정된 사실(승인)을 미확정(결재 대기)보다 앞에** 둔다 —
  //    승인된 조퇴가 있는 날에 다른 신청이 대기 중이라고 "결재 대기"로 적으면 확정 사실이 묻힌다(검수 4차 M-2).
  //  · 승인된 조퇴는 휴가일이 아니라 결근으로 남는다(무단결근을 숨기지 않기 위함) — 이유만 적어 준다.
  for (const l of leaves) if (l.type === "early_leave") addNote(l.userId, l.startDate, l.endDate, "조퇴 승인");
  for (const t of trips) addNote(t.userId, t.startDate, t.endDate, "출장 승인");
  for (const r of remotes) addNote(r.userId, r.startDate, r.endDate, "재택 승인");
  // 종류를 그대로 적는다 — "조퇴 결재 대기"를 "휴가 결재 대기"로 적으면 종일 무단결근이 휴가처럼 보인다(검수 2차 M-5).
  for (const l of pendingLeaves) addNote(l.userId, l.startDate, l.endDate, `${leaveTypeLabel(l.type)} 결재 대기`);

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
    // 회사 계정(사람이 아님)은 집계 대상이 아니다 — 직원 목록 쿼리와 기준을 맞춘다(검수 2차 경미).
    if (r.user.isOwner) continue;
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
    const { absent, onLeave, leaveAll } = dayBreakdown({
      start, absLimit,
      workDays: effectiveWorkDays(u.workDays, company?.workDays),
      offDays, shiftCtx, userId: u.id, shiftGroupId: u.shiftGroupId,
      attended: u.attended, leaveDays: leaveSet,
      hireDate: u.hireDate, deactivatedAt: u.deactivatedAt,
    });

    const blank = { workMode: "-", location: "-", in: "", out: "", breaks: 0, worked: 0, open: false, unclosed: false };
    // 승인 휴가를 날짜 문자열 구간으로 한 번만 펼쳐 둔다(같은 계산을 날마다 되풀이하지 않도록).
    const spans = mine
      .filter((l) => l.type !== "early_leave") // 조퇴는 "휴가로 쉰 날"이 아니다(lib/leave.ts와 같은 기준)
      .map((l) => ({ s: toISODate(l.startDate), e: toISODate(l.endDate), type: l.type, half: HALF_DAY_TYPES.has(l.type) }));
    const coversOf = (iso: string) => spans.filter((sp) => iso >= sp.s && iso <= sp.e);

    // 그날에 걸린 휴가 종류를 **전부** 적는다 — 오전 반차 + 오후 반차를 쓴 날이 "오후 반차"로만 보이면
    // 법정 문서에서 반나절만 쉰 것처럼 읽힌다(날짜→라벨 맵은 하나만 남긴다).
    const labelsOf = (iso: string): string => {
      const seen: string[] = [];
      for (const sp of coversOf(iso)) {
        const label = leaveTypeLabel(sp.type);
        if (!seen.includes(label)) seen.push(label);
      }
      return seen.length ? seen.join(" · ") : labelByDate.get(iso) ?? "휴가";
    };
    // 🔴 승인된 휴가는 **출근 기록이 있어도 반드시 한 줄 남긴다**(검수 3차 C-1).
    //    "출근한 날은 휴가를 세지 않는다"로 했더니, 자정에 잘못 눌린 출근 한 건 때문에
    //    승인된 연차가 근로기록부에서 통째로 사라졌다(연차는 차감된 채로). 법정 기록에서 사실을 지우면 안 된다.
    //    대신 그날 출근도 했다는 것을 라벨에 함께 적어, 근무일수와 휴가가 같은 날 겹친 이유를 알 수 있게 한다.
    const onLeaveSet = new Set(onLeave);
    for (const iso of leaveAll) {
      // "(출근 기록 있음)"은 **종일 휴가인데 출근 기록이 있는** 이상한 날에만 붙인다.
      //  반차는 그날 출근하는 것이 정상이라 매번 붙으면 정상 근무가 이상 징후처럼 보인다(검수 4차 경미).
      const attendedThatDay = !onLeaveSet.has(iso);
      const hasFullDay = coversOf(iso).some((sp) => !sp.half);
      u.rows.push({
        date: iso,
        kind: "leave",
        kindLabel: `휴가 · ${labelsOf(iso)}${attendedThatDay && hasFullDay ? " (출근 기록 있음)" : ""}`,
        ...blank,
      });
    }
    for (const iso of absent) {
      const note = noteByUserDate.get(`${u.id}|${iso}`);
      u.rows.push({ date: iso, kind: "absent", kindLabel: note ? `결근 (${note})` : "결근", ...blank });
    }
    // 날짜순. 같은 날이면 출근 줄이 먼저, 그 안에서는 **출근 시각 순서(입력 순서)를 유지**한다.
    //  ⚠️ 예전엔 `a.kind === "work" ? -1 : 1`로 비교했는데, 같은 날 출근 줄 두 개를 비교하면 양쪽 다 -1이라
    //     비교 규칙이 자기모순이 되어 **하루 두 번 출근한 기록의 시각이 거꾸로 인쇄됐다**(검수 C-1).
    const rank = (k: ReportDayRow["kind"]) => (k === "work" ? 0 : 1);
    u.rows.sort((a, b) => (a.date === b.date ? rank(a.kind) - rank(b.kind) : a.date < b.date ? -1 : 1));

    let overtime = 0;
    for (const v of u.dayMinutes.values()) overtime += Math.max(0, v - standardMin);

    // 휴가 일수 = "그날 승인된 휴가의 크기"의 합. 반차는 0.5일, 하루 최대 1일.
    //  · 그날의 승인건을 **전부 더한다** — 오전 반차 + 오후 반차로 하루를 통째로 쉬면 0.5+0.5 = 1일(검수 2차 C-1).
    //    (날짜→종류 맵으로 하나만 보면 반차 2건이 0.5일로 반토막 나고, DB 행 순서에 따라 값이 흔들렸다)
    //  · 출근 기록이 있는 날도 **그대로 센다** — 승인된 휴가를 숫자에서 빼면 [연차정산]과 어긋나고,
    //    "연차는 차감됐는데 근로기록부엔 없다"가 된다(검수 3차 C-1). 그래서 근무일수와 휴가 일수는
    //    같은 날 겹칠 수 있다 — 이 사실을 두 산출물의 안내문에 명시했다.
    const dayLeaveWeight = (iso: string): number => {
      let w = 0;
      for (const sp of coversOf(iso)) w += sp.half ? 0.5 : 1;
      return Math.min(1, w);
    };
    const leaveDaysCount = Math.round(leaveAll.reduce((s, iso) => s + dayLeaveWeight(iso), 0) * 10) / 10;

    out.push({
      id: u.id, name: u.name, employeeNo: u.employeeNo, role: u.role,
      // "이 기간 안에 이미 퇴사한 사람"만 퇴사로 적는다 — 조회 기간 뒤에 퇴사한 사람의 지난 기록부에
      // "퇴사"가 찍히면 그 기간에도 퇴사자였던 것처럼 읽힌다(검수 3차 N-2).
      resigned: !!u.deactivatedAt && u.deactivatedAt < end,
      rows: u.rows,
      workedDays: u.attended.size,
      totalWorked: u.totalWorked,
      totalBreaks: u.totalBreaks,
      overtime,
      absentDays: absent.length,
      leaveDays: leaveDaysCount,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
