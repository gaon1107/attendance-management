// [운영자 전용] 회원사 목록·상세 조회 (2026-11-18, 운영 준비 3단계)
//
// 🔴 회사 칸막이(companyId 격리)를 넘는 유일한 조회다. 반드시 호출 전에 getCurrentOperator()로 운영자임을 확인한다.
// 🔴 **회사별 합계 숫자만** 돌려준다. 직원 이름·개별 출퇴근·얼굴 정보는 여기서 꺼내지 않는다
//    (본사가 고객사 직원의 근태를 들여다볼 수 있으면 그 자체가 개인정보 문제다).
//
// 회사가 3,000개가 돼도 버티게: 한 화면 조회 횟수가 회사 수와 무관하게 고정이다
//   목록 1 + 전체 개수 1 + 묶음 합계 3(groupBy) + 상단 합계 5 = 10번.
// 🔒 "마지막 사용일"은 **날짜만**(시각 없음), 최근 90일 안에서만 찾는다(3단계 검수 중간 1·경미 7):
//    직원 1~2명 회사에서 분 단위 출근 시각을 보이면 사실상 특정 직원의 개별 출근 기록이 된다.
//    90일로 자르면 3년치 기록을 훑지 않아도 된다.
export const LAST_USE_WINDOW_DAYS = 90;
import { prisma } from "@/lib/db";
import { trialStatus, trialLastDay, TRIAL_DAYS } from "@/lib/trial";
import { THROTTLED_META } from "@/lib/login-throttle";
import type { Prisma } from "@prisma/client";

export const OPERATOR_PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
/** "곧 끝남"으로 보는 남은 일수(대시보드 띠가 주황으로 바뀌는 기준과 같다). */
export const TRIAL_SOON_DAYS = 7;

export type TrialFilter = "all" | "active" | "soon" | "expired" | "demo";
export const TRIAL_FILTERS: { key: TrialFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "active", label: "체험 중" },
  { key: "soon", label: `${TRIAL_SOON_DAYS}일 이내 종료` },
  { key: "expired", label: "종료" },
  { key: "demo", label: "시험용" },
];
export function parseTrialFilter(v: unknown): TrialFilter {
  return TRIAL_FILTERS.some((f) => f.key === v) ? (v as TrialFilter) : "all";
}

function midnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * 무료 상태별 DB 조건. lib/trial.ts의 계산(날짜 단위, 자정 기준)을 DB 조건으로 옮긴 것이다.
 *  · 지정 마지막 날(trialLastDate, 자정으로 저장)이 있으면: 만료 = 마지막 날 < 오늘 0시
 *  · 없으면 가입일 + TRIAL_DAYS: 만료 = 가입 시각 < 오늘 0시 − (TRIAL_DAYS−1)일
 *    (가입 시각이 그날 몇 시든 날짜 단위로 세므로 "−(TRIAL_DAYS−1)일 0시보다 이전"이 정확한 경계다 — 임시 검증으로 확인)
 *  · "곧 끝남" = 만료 아님 ∧ 남은 일수 ≤ 7
 */
function trialWhere(filter: TrialFilter, now: Date): Prisma.CompanyWhereInput {
  const today = midnight(now);
  const at = (days: number) => new Date(today.getTime() + days * DAY_MS);
  const custom = { trialLastDate: { not: null } };
  const auto = { trialLastDate: null };
  switch (filter) {
    case "demo":
      return { isDemo: true };
    case "expired":
      return {
        OR: [
          { ...custom, trialLastDate: { lt: today } },
          { ...auto, createdAt: { lt: at(-(TRIAL_DAYS - 1)) } },
        ],
      };
    case "soon":
      return {
        OR: [
          { trialLastDate: { gte: today, lt: at(TRIAL_SOON_DAYS) } },
          { ...auto, createdAt: { gte: at(-(TRIAL_DAYS - 1)), lt: at(-(TRIAL_DAYS - 1 - TRIAL_SOON_DAYS)) } },
        ],
      };
    case "active":
      return {
        OR: [
          { trialLastDate: { gte: at(TRIAL_SOON_DAYS) } },
          { ...auto, createdAt: { gte: at(-(TRIAL_DAYS - 1 - TRIAL_SOON_DAYS)) } },
        ],
      };
    default:
      return {};
  }
}

export type CompanyRow = {
  id: string;
  name: string;
  createdAt: Date;
  isDemo: boolean;
  trialCustom: boolean; // 운영자가 마지막 날을 정했는가
  trialLast: Date; // 무료 마지막 날(표시용)
  daysLeft: number;
  expired: boolean;
  managerName: string | null;
  managerPhone: string | null;
  employees: number; // 재직 직원 수(회사 계정 제외)
  clockIns7d: number; // 최근 7일 출근 기록 수
  lastClockIn: Date | null; // 최근 90일 안의 마지막 출근(화면에는 날짜만 표시). 없으면 null
};

export type CompanyListResult = {
  rows: CompanyRow[];
  total: number; // 이 조건에 맞는 회사 수(페이지 나누기용)
  page: number;
  pages: number;
  summary: { customers: number; active: number; soon: number; expired: number; demo: number };
};

export async function listCompanies(opts: { q: string; filter: TrialFilter; page: number; now?: Date }): Promise<CompanyListResult> {
  const now = opts.now ?? new Date();
  const q = opts.q.trim().slice(0, 50);
  const where: Prisma.CompanyWhereInput = {
    AND: [q ? { name: { contains: q } } : {}, trialWhere(opts.filter, now)],
  };
  const total = await prisma.company.count({ where });
  const pages = Math.max(1, Math.ceil(total / OPERATOR_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), pages);

  const companies = await prisma.company.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * OPERATOR_PAGE_SIZE,
    take: OPERATOR_PAGE_SIZE,
    select: {
      id: true, name: true, createdAt: true, isDemo: true, trialLastDate: true,
      managerName: true, managerPhone: true,
    },
  });
  const ids = companies.map((c) => c.id);

  // 회사별 합계 — 회사 수와 무관하게 3번(groupBy). 직원 개인 정보는 세지 않고 숫자만 받는다.
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const sinceWindow = new Date(now.getTime() - LAST_USE_WINDOW_DAYS * DAY_MS);
  const [empAgg, recentAgg, lastAgg] = ids.length
    ? await Promise.all([
        prisma.user.groupBy({
          by: ["companyId"],
          where: { companyId: { in: ids }, isOwner: false, deactivatedAt: null },
          _count: { _all: true },
        }),
        prisma.attendance.groupBy({
          by: ["companyId"],
          where: { companyId: { in: ids }, clockIn: { gte: since7 } },
          _count: { _all: true },
        }),
        prisma.attendance.groupBy({
          by: ["companyId"],
          where: { companyId: { in: ids }, clockIn: { gte: sinceWindow } },
          _max: { clockIn: true },
        }),
      ])
    : [[], [], []];
  const empMap = new Map(empAgg.map((g) => [g.companyId, g._count._all]));
  const recentMap = new Map(recentAgg.map((g) => [g.companyId, g._count._all]));
  const lastMap = new Map(lastAgg.map((g) => [g.companyId, g._max.clockIn]));

  const rows: CompanyRow[] = companies.map((c) => {
    const t = trialStatus(c.createdAt, now, c.trialLastDate);
    return {
      id: c.id, name: c.name, createdAt: c.createdAt, isDemo: c.isDemo,
      trialCustom: c.trialLastDate !== null,
      trialLast: trialLastDay(t.endsAt), daysLeft: t.daysLeft, expired: t.expired,
      managerName: c.managerName, managerPhone: c.managerPhone,
      employees: empMap.get(c.id) ?? 0,
      clockIns7d: recentMap.get(c.id) ?? 0,
      lastClockIn: lastMap.get(c.id) ?? null,
    };
  });

  // 상단 합계(시험용 회사는 고객 수에서 뺀다) — 4번
  const notDemo = { isDemo: false };
  const [customers, active, soon, expired, demo] = await Promise.all([
    prisma.company.count({ where: notDemo }),
    prisma.company.count({ where: { AND: [notDemo, trialWhere("active", now)] } }),
    prisma.company.count({ where: { AND: [notDemo, trialWhere("soon", now)] } }),
    prisma.company.count({ where: { AND: [notDemo, trialWhere("expired", now)] } }),
    prisma.company.count({ where: { isDemo: true } }),
  ]);

  return { rows, total, page, pages, summary: { customers, active, soon, expired, demo } };
}

export type CompanyDetail = {
  id: string;
  name: string;
  createdAt: Date;
  isDemo: boolean;
  trialLastDate: Date | null;
  trialLast: Date;
  daysLeft: number;
  expired: boolean;
  bizRegNo: string | null;
  ceoName: string | null;
  managerName: string | null;
  managerTitle: string | null;
  managerPhone: string | null;
  managerEmail: string | null;
  companyPhone: string | null;
  ownerEmail: string | null; // 회사 계정(마스터 열쇠) 로그인 아이디 — 앞 두 글자만 남기고 가린 값(로그인 문의 때 "어느 계정인지" 확인용, 3단계 검수 경미 6)
  employees: number;
  admins: number;
  deactivated: number;
  clockIns30d: number;
  lastClockIn: Date | null;
};

/** "abcdef@gaon.co.kr" → "ab****@gaon.co.kr" (앞 두 글자만 남김). */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "****";
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}${"*".repeat(Math.max(2, local.length - 2))}${email.slice(at)}`;
}

// ── 접속 현황(합계만) — 2026-11-20 사장님 요청 "회원사 화면에 접속 정보" ─────────────────────
// 🔴 이 파일의 원칙 그대로 **합계 숫자와 날짜만** 돌려준다. 누가·몇 시에·어느 IP에서 들어왔는지(개별 로그인 기록)는
//    꺼내지 않는다(본사가 고객사 직원 개인정보를 보는 것 = 위탁 범위 밖. 사장님 결정: 합계만).
// 🔒 날짜만(시각 없음): 직원 1~2명 회사에서 분 단위 시각을 보이면 사실상 특정 직원의 개별 기록이 된다(마지막 사용일과 같은 이유).
// ⚠️ "마지막 접속"을 로그인 기록으로만 보면 틀린다 — 2026-11-20부터 직원 세션은 쓰는 동안 유지돼 로그인이 거의 안 생긴다.
//    그래서 세션의 마지막 활동 시각(Session.lastSeenAt, 5분 간격 갱신)과 접속 기록(AccessEvent)을 함께 본다.
export const ACCESS_WINDOW_DAYS = 30;

// "실제로 앱을 썼다"로 인정하는 기록 종류(검수 중간 1) — 성공한 것만.
//   ⚠️ login_fail·blocked·public_request(재설정 문자 요청)는 **로그인하지 않은 사람도** 그 직원 id로 남긴다.
//   그걸 세면 외부인이 비밀번호를 한 번 틀려도 "오늘 접속·접속 계정 1개"가 돼, 이탈 직전 고객을 사용 중으로 오판한다.
//   로그인한 상태의 나머지 활동은 세션 lastSeenAt이 잡으므로 이렇게 좁혀도 빠지는 사용은 없다.
const USAGE_KINDS = ["login", "logout", "clock_in", "clock_out", "config", "data_view", "purge"];
// "로그인 실패"로 셀 사유(검수 중간 2) — 비밀번호 틀림과 IP 시도 제한만. 퇴사자 시도(deactivated)·임시비번 만료·
//   로그인한 직원의 비밀번호 변경 오타(password_change_denied)는 "비밀번호 공격"이 아니라 섞으면 엉뚱한 문의를 하게 된다.
//   ※ 시도 제한에 걸린 시도는 같은 IP에서 1분에 1건만 남는다(lib/login-throttle.ts) — 실제 시도보다 적게 나온다.
const LOGIN_FAIL_METAS = ["bad_credentials", THROTTLED_META];

export type CompanyAccessSummary = {
  lastActiveDay: Date | null; // 최근 90일 안에서 회사 누군가가 마지막으로 앱을 쓴 날(날짜만 표시). 없으면 null
  ownerLastLoginDay: Date | null; // 회사 계정(마스터)의 마지막 로그인 성공(날짜만). 최근 90일 안에서만(없으면 null)
  logins30d: number; // 최근 30일 로그인 성공 횟수
  loginAccounts30d: number; // 최근 30일 로그인 성공한 계정 수(중복 제외)
  activeAccounts30d: number; // 최근 30일 앱을 쓴 계정 수(성공한 사용 기록 + 세션 활동, 중복 제외)
  ownerActive30d: boolean; // 위 계정 수에 회사 계정이 들어 있는가(화면 문구용)
  loginFails30d: number; // 최근 30일 비밀번호 틀림·시도 제한 횟수(이 회사 계정으로 확인된 것만 — 없는 이메일 시도는 회사를 알 수 없어 빠짐)
};

/** 회사 접속 현황(합계만). 회사 존재 확인은 호출부(getCompanyDetail)가 먼저 한다. 조회 8번(회사 계정 찾기 1 + 묶음 7, 회사 크기와 무관). */
export async function getCompanyAccessSummary(id: string, now: Date = new Date()): Promise<CompanyAccessSummary> {
  const since30 = new Date(now.getTime() - ACCESS_WINDOW_DAYS * DAY_MS);
  const sinceWindow = new Date(now.getTime() - LAST_USE_WINDOW_DAYS * DAY_MS);
  const owner = await prisma.user.findFirst({ where: { companyId: id, isOwner: true }, select: { id: true } });
  const [loginGroups, loginFails30d, eventAccounts, sessionAccounts, lastEvent, lastSession, ownerLogin] = await Promise.all([
    // 로그인 성공 — 계정별로 묶어 횟수 합계와 계정 수를 함께 얻는다(이름·시각은 꺼내지 않음)
    prisma.accessEvent.groupBy({
      by: ["userId"],
      where: { companyId: id, kind: "login", result: "success", createdAt: { gte: since30 } },
      _count: { _all: true },
    }),
    prisma.accessEvent.count({ where: { companyId: id, kind: "login_fail", meta: { in: LOGIN_FAIL_METAS }, createdAt: { gte: since30 } } }),
    // 최근 30일 "성공한 사용" 기록이 있는 계정(로그인·출퇴근·설정 등) — 계정 id만
    prisma.accessEvent.groupBy({
      by: ["userId"],
      where: { companyId: id, userId: { not: null }, result: "success", kind: { in: USAGE_KINDS }, createdAt: { gte: since30 } },
    }),
    // 최근 30일 세션 활동이 있는 계정 — 로그인 유지 중이라 기록이 안 남는 사용도 잡는다
    prisma.session.groupBy({ by: ["userId"], where: { user: { companyId: id }, lastSeenAt: { gte: since30 } } }),
    prisma.accessEvent.aggregate({
      where: { companyId: id, userId: { not: null }, result: "success", kind: { in: USAGE_KINDS }, createdAt: { gte: sinceWindow } },
      _max: { createdAt: true },
    }),
    prisma.session.aggregate({ where: { user: { companyId: id }, lastSeenAt: { gte: sinceWindow } }, _max: { lastSeenAt: true } }),
    // 기간 제한(90일) — 없으면 화면을 열 때마다 그 회사 2년치 기록을 훑는다(검수 경미 5)
    owner
      ? prisma.accessEvent.aggregate({
          where: { companyId: id, userId: owner.id, kind: "login", result: "success", createdAt: { gte: sinceWindow } },
          _max: { createdAt: true },
        })
      : Promise.resolve(null),
  ]);

  const active = new Set<string>();
  for (const g of eventAccounts) if (g.userId) active.add(g.userId);
  for (const g of sessionAccounts) active.add(g.userId);
  const a = lastEvent._max.createdAt;
  const b = lastSession._max.lastSeenAt;
  const lastActive = a && b ? (a > b ? a : b) : (a ?? b ?? null);

  return {
    lastActiveDay: lastActive,
    ownerLastLoginDay: ownerLogin?._max.createdAt ?? null,
    logins30d: loginGroups.reduce((s, g) => s + g._count._all, 0),
    loginAccounts30d: loginGroups.filter((g) => g.userId).length,
    activeAccounts30d: active.size,
    ownerActive30d: owner ? active.has(owner.id) : false,
    loginFails30d,
  };
}

/** 회사 상세(합계만). 없는 회사면 null. */
export async function getCompanyDetail(id: string, now: Date = new Date()): Promise<CompanyDetail | null> {
  const c = await prisma.company.findUnique({
    where: { id },
    select: {
      id: true, name: true, createdAt: true, isDemo: true, trialLastDate: true,
      bizRegNo: true, ceoName: true, managerName: true, managerTitle: true, managerPhone: true, managerEmail: true,
      companyPhone: true,
    },
  });
  if (!c) return null;
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const [owner, employees, admins, deactivated, clockIns30d, last] = await Promise.all([
    prisma.user.findFirst({ where: { companyId: id, isOwner: true }, select: { email: true } }),
    prisma.user.count({ where: { companyId: id, isOwner: false, deactivatedAt: null } }),
    prisma.user.count({ where: { companyId: id, isOwner: false, deactivatedAt: null, role: "admin" } }),
    prisma.user.count({ where: { companyId: id, isOwner: false, deactivatedAt: { not: null } } }),
    prisma.attendance.count({ where: { companyId: id, clockIn: { gte: since30 } } }),
    prisma.attendance.aggregate({ where: { companyId: id, clockIn: { gte: new Date(now.getTime() - LAST_USE_WINDOW_DAYS * DAY_MS) } }, _max: { clockIn: true } }),
  ]);
  const t = trialStatus(c.createdAt, now, c.trialLastDate);
  return {
    ...c,
    trialLast: trialLastDay(t.endsAt), daysLeft: t.daysLeft, expired: t.expired,
    ownerEmail: owner?.email ? maskEmail(owner.email) : null,
    employees, admins, deactivated, clockIns30d, lastClockIn: last._max.clockIn,
  };
}
