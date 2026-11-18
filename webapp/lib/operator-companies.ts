// [운영자 전용] 회원사 목록·상세 조회 (2026-11-18, 운영 준비 3단계)
//
// 🔴 회사 칸막이(companyId 격리)를 넘는 유일한 조회다. 반드시 호출 전에 getCurrentOperator()로 운영자임을 확인한다.
// 🔴 **회사별 합계 숫자만** 돌려준다. 직원 이름·개별 출퇴근·얼굴 정보는 여기서 꺼내지 않는다
//    (본사가 고객사 직원의 근태를 들여다볼 수 있으면 그 자체가 개인정보 문제다).
//
// 회사가 3,000개가 돼도 버티게: 한 화면 조회 횟수가 회사 수와 무관하게 고정이다
//   목록 1 + 전체 개수 1 + 묶음 합계 3(groupBy) + 상단 합계 4 = 9번.
import { prisma } from "@/lib/db";
import { trialStatus, trialLastDay, TRIAL_DAYS } from "@/lib/trial";
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
  lastClockIn: Date | null;
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
          where: { companyId: { in: ids } },
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
  ownerEmail: string | null; // 회사 계정(마스터 열쇠) 로그인 아이디 — 로그인 문의 응대용
  employees: number;
  admins: number;
  deactivated: number;
  clockIns30d: number;
  lastClockIn: Date | null;
};

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
    prisma.attendance.aggregate({ where: { companyId: id }, _max: { clockIn: true } }),
  ]);
  const t = trialStatus(c.createdAt, now, c.trialLastDate);
  return {
    ...c,
    trialLast: trialLastDay(t.endsAt), daysLeft: t.daysLeft, expired: t.expired,
    ownerEmail: owner?.email ?? null,
    employees, admins, deactivated, clockIns30d, lastClockIn: last._max.clockIn,
  };
}
