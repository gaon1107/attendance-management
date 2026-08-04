// 소급 변경 영향 계산 (검수 M-9·M-10) — "이 설정을 바꾸면 과거 기록이 몇 건이나 다르게 읽히는가"를 센다.
//
// 왜 필요한가
//  · 근로기준법상 근태 기록은 3년 보존 대상인데, 이 시스템은 지각·조퇴·결근을 **저장하지 않고 매번 다시 계산**한다.
//    그래서 출근 기준시각을 09:00→10:00으로 바꾸면 **지난달 지각 건수가 통째로 다시 쓰인다.** 휴무일을 나중에
//    등록하면 그날 결근이 사라지고, 지우면 없던 결근이 소급 발생한다.
//  · 이건 버그가 아니라 구조다(판정 스냅샷 저장은 큰 설계 변경이라 별도 과제). 지금 할 수 있는 최선은
//    **바꾸기 전에 영향 건수를 사실대로 보여주고 관리자가 알고 누르게 하는 것**이다.
//
// 설계 원칙
//  ① **데이터를 자동으로 다시 계산하지 않는다.** 이미 차감된 연차를 되돌리거나 과거 판정을 고쳐 쓰지 않는다
//     (되돌리기 어렵고, 잘못 되돌리면 임금 계산이 틀어진다). 세어서 알리기만 한다.
//  ② **세는 범위를 숨기지 않는다.** 과거 전체를 훑으면 느려질 수 있어 최근 1년만 본다 — 그 사실을 문구에 적는다.
//  ③ 판정은 기존 순수함수(lib/worktime.ts isLate·isEarlyLeave)를 그대로 쓴다. 여기서 규칙을 새로 만들지 않는다
//     (규칙이 두 벌이 되면 경고 숫자와 실제 화면 숫자가 어긋난다).
import { prisma } from "@/lib/db";
import { isLate, isEarlyLeave } from "@/lib/worktime";
import { parseDays, daysLabel, effectiveWorkDays, isEffectiveWorkDay } from "@/lib/workdays";
import {
  leaveTypeDeducts, leaveTypeLabel, leaveTypeByDate,
  leaveSuppressesLate, leaveSuppressesEarly, leaveDateSet, LEAVE_TYPES,
} from "@/lib/leave";
import { loadOffDays } from "@/lib/holiday-server";
import { toISODate } from "@/lib/period";
import { dayBreakdown } from "@/lib/report-days";

// 과거를 얼마나 거슬러 세는가. 전 기간을 훑으면 기록이 쌓인 회사에서 저장 버튼이 느려진다.
export const SCAN_DAYS = 365;
export const SCAN_LABEL = "최근 1년";

function scanStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - SCAN_DAYS);
  return d;
}

function dayRange(dateISO: string): { start: Date; end: Date } {
  const [y, m, d] = dateISO.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end };
}

// ── ① 휴무일 소급 등록·삭제의 영향 (M-9) ─────────────────────────────────────
export type HolidayImpact = {
  isPast: boolean; // 오늘 이전 날짜인가(과거 판정이 실제로 바뀌는가)
  attendances: number; // 그날 출근 기록 수
  leaves: number; // 그날을 포함하는 승인·대기 휴가 건수
  deductingLeaves: number; // 그중 연차가 깎이는 휴가 건수(자동 환급 안 됨)
  sampleLeave: string | null; // 예시 1건("홍길동 연차")
  absences: number; // 그날 결근으로 잡히는(또는 잡히게 될) 직원 수 — 추가하면 사라지고, 해제하면 생긴다
};

/**
 * 휴무일을 추가/삭제할 때 과거 기록이 어떻게 달라지는지 센다.
 * @param mode "add" = 휴무일로 지정(그날 결근·지각이 사라짐) / "delete" = 해제(없던 결근이 소급 발생)
 */
export async function countHolidayImpact(
  companyId: string,
  dateISO: string,
  mode: "add" | "delete",
  now: Date = new Date()
): Promise<HolidayImpact> {
  const { start, end } = dayRange(dateISO);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // **오늘도 소급이다**(검수 중간 4) — 오전에 찍힌 지각 8건이 오후에 휴무 지정으로 조용히 사라질 수 있다.
  // 다만 "결근"은 오늘 아직 확정되지 않았으므로 어제까지만 센다.
  const isPast = start <= today;
  const isBeforeToday = start < today;
  const emptyResult: HolidayImpact = {
    isPast: false, attendances: 0, leaves: 0, deductingLeaves: 0, sampleLeave: null, absences: 0,
  };

  // 이미 쉬는 날이면 지정하든 이름만 고치든 **아무것도 바뀌지 않는다** — 허위 경고 금지(검수 중간 5).
  //  (addCompanyHoliday는 upsert라 "같은 날 재등록 = 이름 수정"이 정상 경로다)
  if (mode === "add" && (await isAlreadyOffDay(companyId, dateISO))) return emptyResult;

  // 그날 출근 기록 — 휴무일로 바뀌면 "휴일근무"로, 해제되면 다시 평일근무로 읽힌다.
  const attendances = isPast
    ? await prisma.attendance.count({ where: { companyId, clockIn: { gte: start, lt: end } } })
    : 0;

  // 그날을 포함하는 휴가 — 연차 차감은 **신청 시점에 고정**되므로 나중에 휴무일이 되어도 되돌아오지 않는다.
  //  (미래 날짜여도 이미 승인된 휴가는 차감이 끝나 있어 똑같이 손해가 생긴다 → 과거·미래 구분 없이 센다)
  const leaveWhere = {
    companyId,
    status: { in: ["pending", "approved"] as string[] },
    startDate: { lt: end },
    endDate: { gte: start },
  };
  // 총건수는 count로 따로 센다 — take 상한 때문에 "휴가 200건"으로 과소 표기되지 않게(검수 경미 4).
  const [leaveTotal, leaveRows] = await Promise.all([
    prisma.leaveRequest.count({ where: leaveWhere }),
    prisma.leaveRequest.findMany({
      where: leaveWhere,
      select: { type: true, user: { select: { name: true } } },
      take: 200,
    }),
  ]);
  const deductingSample = leaveRows.filter((r) => leaveTypeDeducts(r.type));
  const deductingTotal =
    leaveRows.length === leaveTotal
      ? deductingSample.length
      : await prisma.leaveRequest.count({ where: { ...leaveWhere, type: { in: DEDUCTING_TYPES } } });
  const sample = deductingSample[0] ?? leaveRows[0] ?? null;

  // 결근 판정이 통째로 뒤집히는 인원 — M-9의 나머지 절반이다.
  //  · 휴무일로 지정하면 그날 결근이 **사라지고**, 해제하면 **없던 결근이 생긴다.**
  //  · "그날이 원래 근무예정일이었는가"를 먼저 본다. 이미 다른 이유(공휴일·주말)로 쉬는 날이면 아무것도 안 바뀐다.
  //  · 판정 게이트는 화면과 같은 규칙(근무요일 ∧ 쉬는날 아님)을 쓴다 — 직원 개인 근무요일 예외도 반영.
  const absences = isBeforeToday ? await countAbsences(companyId, dateISO, start, end, mode) : 0;

  return {
    isPast,
    attendances,
    leaves: leaveTotal,
    deductingLeaves: deductingTotal,
    sampleLeave: sample ? `${sample.user.name} ${leaveTypeLabel(sample.type)}` : null,
    absences,
  };
}

// 연차가 깎이는 휴가 종류 — lib/leave.ts LEAVE_TYPES에서 파생(규칙 중복 금지).
const DEDUCTING_TYPES = LEAVE_TYPES.filter((t) => t.deducts).map((t) => t.key);

/** 그 날짜가 이 회사에서 **이미** 쉬는 날인가(전국 공휴일 또는 회사 휴무일). */
async function isAlreadyOffDay(companyId: string, dateISO: string): Promise<boolean> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { holidayAutoOn: true } });
  const [national, own] = await Promise.all([
    company?.holidayAutoOn ? prisma.holiday.count({ where: { date: dateISO } }) : Promise.resolve(0),
    prisma.companyHoliday.count({ where: { companyId, date: dateISO } }),
  ]);
  return national > 0 || own > 0;
}

/** 그날 "결근"으로 잡히는 재직 직원 수. mode에 따라 이 날이 쉬는 날인지 판단 기준이 다르다. */
async function countAbsences(
  companyId: string,
  dateISO: string,
  start: Date,
  end: Date,
  mode: "add" | "delete"
): Promise<number> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { workDays: true, holidayAutoOn: true, shiftMode: true },
  });
  if (!company) return 0;
  // 교대근무 회사는 그날 조 배정으로 근무예정일이 정해져 이 단순 계산이 맞지 않는다 — 세지 않는다(거짓 숫자 금지).
  if (company.shiftMode) return 0;

  // "이 휴무일을 빼고" 쉬는 날인지 — 추가 전에는 아직 없고, 해제 후에는 없어질 값이므로 둘 다 같은 기준이다.
  const [national, otherCompanyHolidays] = await Promise.all([
    company.holidayAutoOn
      ? prisma.holiday.count({ where: { date: dateISO } })
      : Promise.resolve(0),
    prisma.companyHoliday.count({ where: { companyId, date: dateISO } }),
  ]);
  // add: 아직 등록 전이므로 otherCompanyHolidays는 0이 정상(같은 날 재등록이면 이미 쉬는 날 → 변화 없음).
  // delete: 지금 1건 있고 그게 지워질 대상이므로 "다른 회사휴무일"은 없다고 본다.
  const alreadyOffWithout = national > 0 || (mode === "add" ? otherCompanyHolidays > 0 : otherCompanyHolidays > 1);
  if (alreadyOffWithout) return 0; // 다른 이유로도 쉬는 날 → 판정이 바뀌지 않는다

  // ⚠️ 결근 규칙을 여기서 새로 쓰지 않는다 — 리포트·엑셀·근로기록부가 함께 쓰는 **단일 출처**
  //    lib/report-days.ts dayBreakdown을 그대로 부른다(검수 중간 2).
  //    직접 세면 입사일 이전(과대)·지난달 퇴사자(과소)·조퇴 면제(과소)가 리포트와 어긋난다.
  //    · 퇴사자도 포함한다 — 그날 재직 중이었으면 리포트에 결근이 찍히기 때문(dayBreakdown이 퇴사일로 자른다).
  const users = await prisma.user.findMany({
    where: { companyId, isOwner: false, OR: [{ deactivatedAt: null }, { deactivatedAt: { gt: start } }] },
    select: { id: true, workDays: true, hireDate: true, deactivatedAt: true, shiftGroupId: true },
  });
  if (users.length === 0) return 0;

  const ids = users.map((u) => u.id);
  const [attended, leaves] = await Promise.all([
    prisma.attendance.findMany({
      where: { companyId, userId: { in: ids }, clockIn: { gte: start, lt: end } },
      select: { userId: true, clockIn: true },
    }),
    prisma.leaveRequest.findMany({
      where: { companyId, userId: { in: ids }, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, type: true, startDate: true, endDate: true },
    }),
  ]);
  const attByUser = groupBy(attended, (a) => a.userId);
  const lvByUser = groupBy(leaves, (l) => l.userId);
  // 이 계산은 "그 하루"만 본다 — 휴무일이 아직 없는(또는 없어질) 상태를 전제하므로 offDays는 비운다.
  const emptyOff = new Set<string>();

  let count = 0;
  for (const u of users) {
    const { absent } = dayBreakdown({
      start,
      absLimit: end,
      workDays: effectiveWorkDays(u.workDays, company.workDays),
      offDays: emptyOff,
      shiftCtx: null, // 교대회사는 위에서 이미 반환했다
      userId: u.id,
      shiftGroupId: u.shiftGroupId,
      attended: new Set((attByUser.get(u.id) ?? []).map((a) => toISODate(a.clockIn))),
      leaveDays: leaveDateSet(lvByUser.get(u.id) ?? []),
      hireDate: u.hireDate,
      deactivatedAt: u.deactivatedAt,
    });
    count += absent.length;
  }
  return count;
}

/** 휴무일 영향 → 사람이 읽는 경고 문구. 영향이 없으면 null(경고하지 않는다). */
export function holidayWarning(dateISO: string, mode: "add" | "delete", im: HolidayImpact): string | null {
  const lines: string[] = [];
  if (im.isPast && im.attendances > 0) {
    lines.push(
      mode === "add"
        ? `· ${dateISO}의 출근 기록 ${im.attendances}건이 앞으로 '휴일 근무'로 읽힙니다(지각 판정이 사라집니다).`
        : `· ${dateISO}의 출근 기록 ${im.attendances}건이 다시 평일 근무로 읽힙니다(지각 판정이 되살아납니다).`
    );
  }
  if (im.isPast && im.absences > 0) {
    lines.push(
      mode === "add"
        ? `· 그날 결근으로 기록돼 있던 직원 ${im.absences}명의 **결근이 사라집니다.**`
        : `· 그날 출근하지 않은 직원 ${im.absences}명에게 **결근이 소급 발생합니다.**`
    );
  } else if (im.isPast && im.attendances === 0 && mode === "delete") {
    lines.push(`· ${dateISO}은 지난 날짜입니다. 휴무일을 풀면 그날의 근태 판정이 다시 계산됩니다.`);
  }
  if (mode === "add" && im.deductingLeaves > 0) {
    lines.push(
      `· 이 날을 포함하는 휴가가 ${im.leaves}건 있고, 그중 ${im.deductingLeaves}건은 연차가 깎이는 휴가입니다` +
        `${im.sampleLeave ? `(예: ${im.sampleLeave})` : ""}. **이미 깎인 연차는 자동으로 돌아오지 않습니다** — 직원별로 직접 조정해 주세요.`
    );
  }
  return lines.length ? lines.join("\n") : null;
}

// ── ② 근무규칙 변경의 영향 (M-10) ────────────────────────────────────────────
export type WorkRuleSnapshot = {
  workStartTime: string | null;
  workEndTime: string | null;
  lateGraceMin: number;
  workDays: string | null;
  shiftMode: number | null;
  standardWorkHours: number | null; // 기준 일 근무시간 — 바꾸면 과거 초과근무 시간이 다시 계산된다
};

export type WorkRuleImpact = {
  lateChanged: number; // 지각 판정이 뒤집히는 과거 출근 기록 수
  earlyChanged: number; // 조퇴 판정이 뒤집히는 과거 출근 기록 수
  scanned: number; // 게이트를 통과해 실제로 판정 대상인 과거 출근 기록 수
  firstTimeRule: boolean; // 기준시각을 처음 설정하는가(그전엔 판정 자체가 없었다)
  countSkippedForShift: boolean; // 교대회사라 건수를 세지 않았는가(표준 시각이 판정에 안 쓰인다)
  workDaysBefore: string | null;
  workDaysAfter: string | null;
  workDaysChanged: boolean;
  shiftBefore: number | null;
  shiftAfter: number | null;
  shiftChanged: boolean;
  stdHoursBefore: number | null;
  stdHoursAfter: number | null;
  stdHoursChanged: boolean;
};

/**
 * 근무 기준시각·유예·근무요일·교대제를 바꿀 때 과거 판정이 몇 건이나 뒤집히는지 센다.
 * 판정은 화면과 같은 순수함수(isLate·isEarlyLeave)로 계산하므로 숫자가 어긋나지 않는다.
 */
export async function countWorkRuleImpact(
  companyId: string,
  before: WorkRuleSnapshot,
  after: WorkRuleSnapshot,
  now: Date = new Date()
): Promise<WorkRuleImpact> {
  const workDaysChanged = (before.workDays ?? "") !== (after.workDays ?? "");
  const timeRuleChanged =
    before.workStartTime !== after.workStartTime ||
    before.workEndTime !== after.workEndTime ||
    before.lateGraceMin !== after.lateGraceMin;
  // 근무요일이 바뀌어도 판정이 뒤집힌다(토요일을 근무일로 넣으면 그날 출근이 평일근무가 되고 지각이 생긴다).
  const needScan = timeRuleChanged || workDaysChanged;
  // 교대회사는 지각·조퇴를 조별 시각(judgeByShift)으로 판정해 **회사 표준 시각을 아예 쓰지 않는다.**
  //  그런데도 표준 시각으로 세면 100% 허구의 숫자가 나온다 → 세지 않고 문장으로만 알린다(검수 치명 2).
  const shiftCompany = !!(before.shiftMode || after.shiftMode);

  let lateChanged = 0;
  let earlyChanged = 0;
  let scanned = 0;
  if (needScan && !shiftCompany) {
    const since = scanStart(now);
    const [rows, company, users] = await Promise.all([
      prisma.attendance.findMany({
        where: { companyId, clockIn: { gte: since } },
        select: { userId: true, clockIn: true, clockOut: true },
      }),
      prisma.company.findUnique({ where: { id: companyId }, select: { holidayAutoOn: true } }),
      prisma.user.findMany({ where: { companyId }, select: { id: true, workDays: true } }),
    ]);
    // 쉬는 날·휴가 면제까지 **화면과 같은 규칙**으로 걸러야 숫자가 어긋나지 않는다.
    const offDays = await loadOffDays(companyId, company?.holidayAutoOn ?? true, since, now);
    const leaves = await prisma.leaveRequest.findMany({
      where: { companyId, status: "approved", endDate: { gte: since } },
      select: { userId: true, type: true, startDate: true, endDate: true },
    });
    const leaveByUser = new Map<string, Map<string, string>>();
    for (const [uid, list] of groupBy(leaves, (l) => l.userId)) leaveByUser.set(uid, leaveTypeByDate(list));
    const wdOfUser = new Map(users.map((u) => [u.id, u.workDays]));

    for (const r of rows) {
      // ── 게이트: 근무요일 ∧ 쉬는날 아님. 이걸 빼면 주말·공휴일 출근까지 "지각이 뒤집힌다"고 센다.
      //    근무요일은 before/after가 다를 수 있어 각각의 기준으로 본다.
      const raw = wdOfUser.get(r.userId);
      const wdBefore = effectiveWorkDays(raw, before.workDays);
      const wdAfter = effectiveWorkDays(raw, after.workDays);
      const onBefore = isEffectiveWorkDay(r.clockIn, wdBefore, offDays);
      const onAfter = isEffectiveWorkDay(r.clockIn, wdAfter, offDays);
      if (!onBefore && !onAfter) continue; // 양쪽 다 판정 대상이 아니면 아무것도 안 바뀐다
      scanned++;

      const iso = toISODate(r.clockIn);
      const lt = leaveByUser.get(r.userId)?.get(iso);
      // 승인된 반차·조퇴가 있으면 화면은 자동판정을 면제한다 — 여기서도 똑같이 면제한다.
      if (!(lt && leaveSuppressesLate(lt))) {
        const b = onBefore ? isLate(r.clockIn, before.workStartTime, before.lateGraceMin) : null;
        const a = onAfter ? isLate(r.clockIn, after.workStartTime, after.lateGraceMin) : null;
        if (b !== a && (b === true || a === true)) lateChanged++; // 실제로 지각 표시가 생기거나 사라지는 것만
      }
      if (!(lt && leaveSuppressesEarly(lt))) {
        const b = onBefore ? isEarlyLeave(r.clockOut, before.workEndTime) : null;
        const a = onAfter ? isEarlyLeave(r.clockOut, after.workEndTime) : null;
        if (b !== a && (b === true || a === true)) earlyChanged++;
      }
    }
  }

  return {
    lateChanged,
    earlyChanged,
    scanned,
    firstTimeRule: !before.workStartTime && !!after.workStartTime,
    countSkippedForShift: needScan && shiftCompany,
    workDaysBefore: before.workDays,
    workDaysAfter: after.workDays,
    workDaysChanged,
    shiftBefore: before.shiftMode,
    shiftAfter: after.shiftMode,
    shiftChanged: before.shiftMode !== after.shiftMode,
    stdHoursBefore: before.standardWorkHours,
    stdHoursAfter: after.standardWorkHours,
    stdHoursChanged: before.standardWorkHours !== after.standardWorkHours,
  };
}

/** 작은 groupBy — 사용처가 여기뿐이라 lib을 새로 만들지 않는다. */
function groupBy<T, K>(list: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of list) {
    const k = key(it);
    const cur = m.get(k);
    if (cur) cur.push(it);
    else m.set(k, [it]);
  }
  return m;
}

// 영향 계산이 실패했을 때 쓰는 보수적 문구 — **계산 실패가 곧 무경고 저장이 되면 안 된다**(검수 중간 6).
export const IMPACT_FAILED_WARNING =
  "영향 건수를 계산하지 못했습니다(일시적인 오류일 수 있습니다).\n" +
  "이 설정은 지난 기록의 지각·결근 판정을 바꿀 수 있습니다. 그래도 진행하시겠습니까?";

/** 확인받은 값과 지금 저장하려는 값이 같은지 대조하는 지문 — 경고를 본 뒤 값을 바꿔 저장하는 것을 막는다. */
export function workRuleSignature(s: WorkRuleSnapshot): string {
  return [s.workStartTime ?? "", s.workEndTime ?? "", s.lateGraceMin, s.workDays ?? "", s.shiftMode ?? "", s.standardWorkHours ?? ""].join("|");
}

/** 근무규칙 영향 → 사람이 읽는 경고 문구. 영향이 없으면 null. */
export function workRuleWarning(im: WorkRuleImpact): string | null {
  const lines: string[] = [];
  if (im.lateChanged > 0) {
    lines.push(
      im.firstTimeRule
        ? `· 기준시각을 처음 정하는 것이라, ${SCAN_LABEL} 출근 기록 ${im.scanned}건 중 ${im.lateChanged}건이 **새로 '지각'으로 표시됩니다**(지금까지는 판정이 없었습니다).`
        : `· ${SCAN_LABEL} 출근 기록 ${im.scanned}건 중 ${im.lateChanged}건의 **지각 표시가 생기거나 사라집니다.**`
    );
  }
  if (im.earlyChanged > 0) {
    lines.push(`· ${SCAN_LABEL} 기록 중 ${im.earlyChanged}건의 **조퇴 표시가 생기거나 사라집니다.**`);
  }
  if (im.countSkippedForShift) {
    // 교대회사는 조별 시각으로 판정하므로 표준 시각 기준 건수를 세면 허구가 된다 — 세지 않았음을 밝힌다.
    lines.push(`· 교대근무 회사라 표준 기준시각으로는 영향 건수를 셀 수 없습니다(판정은 조별 시각으로 합니다). 조 시각을 바꾸면 과거 판정도 함께 바뀝니다.`);
  }
  if (im.workDaysChanged) {
    lines.push(
      `· 근무요일이 ${daysLabel(parseDays(im.workDaysBefore))} → ${daysLabel(parseDays(im.workDaysAfter))}로 바뀝니다. ` +
        `과거 날짜의 결근·지각 판정도 새 요일 기준으로 다시 읽힙니다.`
    );
  }
  if (im.stdHoursChanged) {
    lines.push(
      `· 기준 일 근무시간이 ${im.stdHoursBefore ?? "미설정"}시간 → ${im.stdHoursAfter ?? "미설정"}시간으로 바뀝니다. ` +
        `**지난 기간의 초과근무(연장) 시간이 다시 계산됩니다** — 급여에 반영했다면 숫자가 달라집니다.`
    );
  }
  if (im.shiftChanged) {
    lines.push(
      im.shiftAfter
        ? `· 교대근무를 켭니다. **과거 전 기간이 교대 기준으로 다시 해석됩니다** — 조가 배정되지 않은 과거 날짜는 '휴무'가 되어 그날 출근이 '휴일근무'로, 결근은 사라집니다.`
        : `· 교대근무를 끕니다. 과거 전 기간이 다시 표준 출퇴근 시각 기준으로 읽힙니다.`
    );
  }
  if (!lines.length) return null;
  lines.push(
    `지난 기록의 판정만 달라지고 출퇴근 시각 자체는 바뀌지 않습니다. 이미 확정한 급여·근로기록부와 숫자가 달라질 수 있습니다.\n` +
      `※ 위 건수는 ${SCAN_LABEL}만 센 것입니다. 그보다 이전 기록(법정 보존 3년)도 같은 기준으로 다시 계산됩니다.`
  );
  return lines.join("\n");
}

/** 감사로그에 남길 한 줄 — 무엇이 무엇으로 바뀌었는지. (회사 설정값이라 개인정보가 아니다) */
export function workRuleAuditText(im: WorkRuleImpact, before: WorkRuleSnapshot, after: WorkRuleSnapshot): string {
  const parts: string[] = [];
  if (before.workStartTime !== after.workStartTime) parts.push(`출근 ${before.workStartTime ?? "없음"}→${after.workStartTime ?? "없음"}`);
  if (before.workEndTime !== after.workEndTime) parts.push(`퇴근 ${before.workEndTime ?? "없음"}→${after.workEndTime ?? "없음"}`);
  if (before.lateGraceMin !== after.lateGraceMin) parts.push(`유예 ${before.lateGraceMin}→${after.lateGraceMin}분`);
  if (im.workDaysChanged) parts.push(`근무요일 ${daysLabel(parseDays(im.workDaysBefore))}→${daysLabel(parseDays(im.workDaysAfter))}`);
  if (im.stdHoursChanged) parts.push(`기준근무 ${im.stdHoursBefore ?? "없음"}→${im.stdHoursAfter ?? "없음"}시간`);
  if (im.shiftChanged) parts.push(`교대 ${before.shiftMode ?? "안함"}→${after.shiftMode ?? "안함"}`);
  const impact = im.lateChanged + im.earlyChanged > 0 ? `, 과거판정변경 지각${im.lateChanged}·조퇴${im.earlyChanged}건` : "";
  return parts.length ? `work_rules(${parts.join(", ")}${impact})` : "work_rules";
}

/** 휴무일 감사로그 한 줄 — 어느 날짜를 건드렸는지(날짜는 개인정보가 아니다). */
export function holidayAuditText(mode: "add" | "delete", dateISO: string, im: HolidayImpact): string {
  const impact: string[] = [];
  if (im.attendances > 0) impact.push(`출근기록${im.attendances}건`);
  if (im.absences > 0) impact.push(`결근${im.absences}명`);
  if (im.deductingLeaves > 0) impact.push(`차감휴가${im.deductingLeaves}건`);
  return `company_holiday_${mode === "add" ? "add" : "del"}(${dateISO}${im.isPast ? ", 소급" : ""}${impact.length ? ", " + impact.join("·") : ""})`;
}
