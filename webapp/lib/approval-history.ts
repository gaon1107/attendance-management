// 관리자 결재 이력 조회 — 6종 신청(휴가·근태정정·외출/외근·재택·초과근무·출장)을 회사 단위로 모아
// "누가·무엇을·언제 신청했고 / 누가·왜·언제 승인·반려했는지"를 공통 표 한 줄로 정규화한다.
//  · 읽기 전용(조회만). 회사격리(companyId) 필수. 결재 엔진·판정 로직 무접촉.
//  · 각 신청 모델은 status·createdAt·decidedAt·decisionComment·decidedById 필드가 동일해 공통 처리한다.
import { prisma } from "@/lib/db";
import type { RequestType } from "@/lib/approval-server";
import { leaveTypeLabel } from "@/lib/leave";
import { outingKindLabel } from "@/lib/outing";
import { remoteRangeLabel } from "@/lib/remote";
import { overtimeTimeLabel } from "@/lib/overtime-request";
import { tripRangeLabel } from "@/lib/trip";

export type HistoryStatus = "pending" | "approved" | "rejected";

// 이력 표 한 줄(정규화).
export type HistoryRow = {
  type: RequestType;
  requestId: string;
  applicantName: string;
  applicantNo: string | null;
  applicantDept: string | null;
  summary: string;                 // 유형 세부 + 기간/일시 요약
  reason: string | null;           // 신청 사유
  status: string;                  // pending | approved | rejected
  decisionComment: string | null;  // 결재자 결정 사유(승인 메모/반려 사유)
  decidedByName: string | null;    // 처리자 이름
  decidedAt: Date | null;          // 처리 시각
  createdAt: Date;                 // 신청 시각
};

export type HistoryFilter = {
  type?: RequestType | "all";
  status?: HistoryStatus | "all";
  userId?: string | "all";
  from?: Date | null;  // createdAt >= from
  to?: Date | null;    // createdAt <= to
};

// 조회 상한(한 화면). 필터로 좁히면 충분하고, 과도한 로드를 막는다.
export const HISTORY_LIMIT = 300;

function mdHm(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
function rangeLabel(a: Date, b: Date): string {
  const s = mdHm(a), e = mdHm(b);
  return s === e ? s : `${s}~${e}`;
}

// 각 신청 공통 필드(정규화 원천). type/summary는 유형별로 채운다.
type Applicant = { name: string; employeeNo: string | null; department: { name: string } | null };
type CommonReq = { id: string; user: Applicant; status: string; decisionComment: string | null; decidedById: string | null; decidedAt: Date | null; createdAt: Date };
type Raw = Omit<HistoryRow, "decidedByName"> & { decidedById: string | null };

const userSelect = { select: { name: true, employeeNo: true, department: { select: { name: true } } } } as const;

function toRaw(type: RequestType, r: CommonReq, summary: string, reason: string | null): Raw {
  return {
    type,
    requestId: r.id,
    applicantName: r.user.name,
    applicantNo: r.user.employeeNo,
    applicantDept: r.user.department?.name ?? null,
    summary,
    reason,
    status: r.status,
    decisionComment: r.decisionComment,
    decidedById: r.decidedById,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
  };
}

export async function listApprovalHistory(
  companyId: string,
  filter: HistoryFilter = {},
  limit: number = HISTORY_LIMIT,
): Promise<HistoryRow[]> {
  const wantType = filter.type && filter.type !== "all" ? filter.type : null;
  const wantStatus = filter.status && filter.status !== "all" ? filter.status : null;
  const wantUser = filter.userId && filter.userId !== "all" ? filter.userId : null;

  // 각 신청 모델 공통 where(회사격리 + 선택 필터). createdAt 범위는 신청 시각 기준.
  const createdAt =
    filter.from || filter.to
      ? { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) }
      : undefined;
  const baseWhere = {
    companyId,
    ...(wantStatus ? { status: wantStatus } : {}),
    ...(wantUser ? { userId: wantUser } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
  const common = { where: baseWhere, orderBy: { createdAt: "desc" as const }, take: limit, include: { user: userSelect } };

  // 유형 필터가 있으면 그 표만 조회(불필요한 쿼리 생략).
  const run = (t: RequestType) => !wantType || wantType === t;

  const [leaves, corrs, outings, remotes, overtimes, trips] = await Promise.all([
    run("leave") ? prisma.leaveRequest.findMany(common) : Promise.resolve([]),
    run("correction") ? prisma.attendanceCorrection.findMany(common) : Promise.resolve([]),
    run("outing") ? prisma.outingRequest.findMany(common) : Promise.resolve([]),
    run("remote") ? prisma.remoteWorkRequest.findMany(common) : Promise.resolve([]),
    run("overtime") ? prisma.overtimeRequest.findMany(common) : Promise.resolve([]),
    run("trip") ? prisma.businessTripRequest.findMany(common) : Promise.resolve([]),
  ]);

  const raws: Raw[] = [];
  for (const r of leaves) raws.push(toRaw("leave", r, `${leaveTypeLabel(r.type)} (${rangeLabel(r.startDate, r.endDate)}) · ${r.days}일`, r.reason));
  for (const r of corrs) {
    const parts = [r.requestedIn ? `출근 ${r.requestedIn}` : "", r.requestedOut ? `퇴근 ${r.requestedOut}` : ""].filter(Boolean).join(" · ");
    raws.push(toRaw("correction", r, `근태정정 (${mdHm(r.targetDate)})${parts ? ` ${parts}` : ""}`, r.reason));
  }
  for (const r of outings) raws.push(toRaw("outing", r, `${outingKindLabel(r.kind)} (${mdHm(r.targetDate)} ${r.startTime}~${r.endTime})${r.place ? ` · ${r.place}` : ""}`, r.reason));
  for (const r of remotes) raws.push(toRaw("remote", r, `재택근무 (${remoteRangeLabel(r.startDate, r.endDate)})`, r.reason));
  for (const r of overtimes) raws.push(toRaw("overtime", r, `초과근무 (${mdHm(r.targetDate)} ${overtimeTimeLabel(r.startTime, r.endTime)})`, r.reason));
  for (const r of trips) raws.push(toRaw("trip", r, `출장 (${tripRangeLabel(r.startDate, r.endDate)}) · ${r.destination}`, r.reason));

  // 신청 시각 내림차순 + 상한(여러 표를 합쳤으므로 전체 정렬 후 자른다).
  raws.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const limited = raws.slice(0, limit);

  // 처리자 이름 일괄 해석(회사격리).
  const deciderIds = [...new Set(limited.map((r) => r.decidedById).filter((v): v is string => !!v))];
  const nameOf = new Map<string, string>();
  if (deciderIds.length) {
    const users = await prisma.user.findMany({ where: { companyId, id: { in: deciderIds } }, select: { id: true, name: true } });
    for (const u of users) nameOf.set(u.id, u.name);
  }

  return limited.map(({ decidedById, ...r }) => ({ ...r, decidedByName: decidedById ? nameOf.get(decidedById) ?? null : null }));
}
