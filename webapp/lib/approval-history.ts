// 관리자 결재 이력 조회 — 6종 신청(휴가·근태정정·외출/외근·재택·초과근무·출장)을 회사 단위로 모아
// "누가·무엇을·언제 신청했고 / 누가·왜·언제 승인·반려했는지"를 공통 표 한 줄로 정규화한다.
//  · 읽기 전용(조회만). 회사격리(companyId) 필수. 결재 엔진·판정 로직 무접촉.
//  · 각 신청 모델은 status·createdAt·decidedAt·decisionComment·decidedById 필드가 동일해 공통 처리한다.
import { prisma } from "@/lib/db";
import { getApprovalProgressMap, approvalProgressLabel, type RequestType, type ApprovalProgress } from "@/lib/approval-server";
import { leaveTypeLabel } from "@/lib/leave";
import { outingKindLabel } from "@/lib/outing";
import { remoteRangeLabel } from "@/lib/remote";
import { overtimeTimeLabel } from "@/lib/overtime-request";
import { tripRangeLabel } from "@/lib/trip";

// "cancelled"(승인 취소)는 지금 휴가에만 있다 — 관리자가 잘못 승인한 휴가를 되돌린 상태(2026-08-03).
export type HistoryStatus = "pending" | "approved" | "rejected" | "cancelled";

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
  // 대기(pending) 건의 결재 진행 문구(승인 화면들과 같은 공통 문구, 9-E).
  // "결재자 퇴사로 건너뜀 (n/m) · 관리자 확정 필요" 같은 상태가 이력에서 그냥 "대기"로만 보이던 것을 보완.
  progressText: string | null;
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
// origApprover*는 승인 취소된 휴가에만 채운다 — "누가 언제 승인했다가 누가 왜 취소했나"를 한 줄로 남기기 위함(검수 M-5).
type Raw = Omit<HistoryRow, "decidedByName"> & { decidedById: string | null; origApproverId?: string | null; origApprovedAt?: Date | null };

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
    progressText: null, // 대기 건만 마지막에 일괄 채운다(쿼리 절약)
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
  for (const r of leaves) {
    const raw = toRaw("leave", r, `${leaveTypeLabel(r.type)} (${rangeLabel(r.startDate, r.endDate)}) · ${r.days}일`, r.reason);
    // 승인 취소된 휴가는 **마지막 처리(취소)**를 보여준다 — 이력 표의 처리자·처리시각·사유는 "가장 최근 결정"을 뜻하므로,
    // 승인 메모가 남아 있으면 이미 취소된 건이 아직 유효한 승인처럼 읽힌다.
    // (승인 시점 정보는 DB와 [휴가 승인] 화면에 그대로 남아 있다)
    if (r.status === "cancelled") {
      raw.decisionComment = `승인 취소 사유: ${r.cancelReason ?? "—"}`;
      raw.decidedById = r.cancelledById;
      raw.decidedAt = r.cancelledAt;
      // 원래 승인 정보는 지우지 않고 의견 칸 끝에 덧붙인다(아래에서 이름을 붙인다).
      raw.origApproverId = r.decidedById;
      raw.origApprovedAt = r.decidedAt;
    }
    raws.push(raw);
  }
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

  // 처리자 이름 일괄 해석(회사격리). 승인 취소 건은 "원래 승인자"까지 함께 해석한다.
  const deciderIds = [...new Set(limited.flatMap((r) => [r.decidedById, r.origApproverId ?? null]).filter((v): v is string => !!v))];
  const nameOf = new Map<string, string>();
  if (deciderIds.length) {
    const users = await prisma.user.findMany({ where: { companyId, id: { in: deciderIds } }, select: { id: true, name: true } });
    for (const u of users) nameOf.set(u.id, u.name);
  }

  // 대기 건의 결재 진행 문구(9-E) — 유형별로 묶어 공통 함수로 일괄 조회(최대 6쿼리).
  // 승인 화면 13곳과 같은 문구 출처(approvalProgressLabel)라 화면마다 다른 말을 하지 않는다.
  const pendingByType = new Map<RequestType, string[]>();
  for (const r of limited) {
    if (r.status !== "pending") continue;
    const arr = pendingByType.get(r.type) ?? [];
    arr.push(r.requestId);
    pendingByType.set(r.type, arr);
  }
  const progressByType = new Map<RequestType, Map<string, ApprovalProgress>>();
  await Promise.all(
    [...pendingByType].map(async ([t, ids]) => {
      progressByType.set(t, await getApprovalProgressMap(companyId, t, ids));
    }),
  );

  return limited.map(({ decidedById, origApproverId, origApprovedAt, ...r }) => {
    // 승인 취소 건: "승인 취소 사유: … (원래 승인: 홍길동 · 2026-08-03)" — 감사 추적이 반쪽이 되지 않게.
    let comment = r.decisionComment;
    if (origApprovedAt || origApproverId) {
      const who = origApproverId ? nameOf.get(origApproverId) ?? null : null;
      const when = origApprovedAt ? origApprovedAt.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : null;
      const parts = [who, when].filter(Boolean).join(" · ");
      if (parts) comment = `${comment ?? ""} (원래 승인: ${parts})`.trim();
    }
    return {
      ...r,
      decisionComment: comment,
      decidedByName: decidedById ? nameOf.get(decidedById) ?? null : null,
      progressText: r.status === "pending" ? approvalProgressLabel(progressByType.get(r.type)?.get(r.requestId)) ?? null : null,
    };
  });
}
