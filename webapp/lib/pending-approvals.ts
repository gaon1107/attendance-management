// 밀린 결재 현황(관리자) — 6종 신청(휴가·근태정정·외출/외근·재택·초과근무·출장) 중
// 아직 결정 안 난(status="pending") 것을 회사 단위로 모아 "누가·무엇을·며칠째·지금 누구 차례"로 정규화한다.
//  · 읽기 전용(조회만). 회사격리(companyId) 필수. 결재 엔진·판정 로직 무접촉.
//  · 진행상태(누구 차례·몇 단계 중 몇·전결)는 기존 getApprovalProgressMap을 그대로 재사용한다.
//  · 결재선 없는 신청(single 모드 또는 결재자 폴백) = ApprovalStep 0건 → "관리자 승인 대기"로 표시한다.
import { prisma } from "@/lib/db";
import { getApprovalProgressMap, type RequestType, type ApprovalProgress } from "@/lib/approval-server";
import { leaveTypeLabel } from "@/lib/leave";
import { outingKindLabel } from "@/lib/outing";
import { remoteRangeLabel } from "@/lib/remote";
import { overtimeTimeLabel } from "@/lib/overtime-request";
import { tripRangeLabel } from "@/lib/trip";

// 밀린 결재 한 줄(정규화).
export type PendingRow = {
  type: RequestType;
  requestId: string;
  applicantName: string;
  applicantNo: string | null;
  applicantDept: string | null;
  summary: string; // 유형 세부 + 기간/일시 요약
  reason: string | null;
  createdAt: Date; // 신청 시각
  waitingDays: number; // 신청 후 경과일(0=오늘, 캘린더 일수)
  // 진행상태(결재선 있는 경우). 없으면 stepTotal=0 + nextApproverName=null(=관리자 승인 대기).
  stepTotal: number; // 전체 단계 수(0=결재선 없음)
  approvedCount: number; // 승인 완료 단계 수
  nextApproverName: string | null; // 지금 차례인 결재자 이름(null=관리자 대기 또는 진행정보 없음)
  nextIsFinal: boolean; // 지금 차례가 전결권자면 그 승인이 최종
};

// 조회 상한(한 화면). 밀린 건은 보통 많지 않지만, 과도한 로드를 막는다(결재이력과 동일 관례).
export const PENDING_LIMIT = 300;

function mdHm(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
function rangeLabel(a: Date, b: Date): string {
  const s = mdHm(a), e = mdHm(b);
  return s === e ? s : `${s}~${e}`;
}

// 신청 시각 → 지금까지 경과한 "캘린더 일수"(로컬 자정 기준). 같은 날=0, 어제=1 …
//  · 시각 차가 아니라 날짜(자정)의 차로 세어, "3일째 대기" 같은 사람이 이해하는 표현과 맞춘다.
export function waitingDaysBetween(createdAt: Date, now: Date): number {
  const a = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff < 0 ? 0 : diff; // 미래 신청(있을 수 없음) 방어
}

type Applicant = { name: string; employeeNo: string | null; department: { name: string } | null };
type CommonReq = { id: string; user: Applicant; createdAt: Date; reason: string | null };
const userSelect = { select: { name: true, employeeNo: true, department: { select: { name: true } } } } as const;

// 회사의 "안 끝난 결재"를 전부 모아 오래된 순(가장 밀린 것 위)으로 돌려준다.
//  · wantType: 특정 유형만 보고 싶을 때(없으면 6종 전부).
//  · now: 경과일 계산 기준(테스트 주입용, 기본 현재시각).
export async function listPendingApprovals(
  companyId: string,
  opts: { type?: RequestType | "all"; now?: Date; limit?: number } = {},
): Promise<PendingRow[]> {
  const wantType = opts.type && opts.type !== "all" ? opts.type : null;
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? PENDING_LIMIT;
  const run = (t: RequestType) => !wantType || wantType === t;

  // 각 유형 공통: 회사격리 + pending만. 신청자 정보 포함.
  const common = {
    where: { companyId, status: "pending" as const },
    orderBy: { createdAt: "asc" as const }, // 오래된 것 우선
    take: limit,
    include: { user: userSelect },
  };

  const [leaves, corrs, outings, remotes, overtimes, trips] = await Promise.all([
    run("leave") ? prisma.leaveRequest.findMany(common) : Promise.resolve([]),
    run("correction") ? prisma.attendanceCorrection.findMany(common) : Promise.resolve([]),
    run("outing") ? prisma.outingRequest.findMany(common) : Promise.resolve([]),
    run("remote") ? prisma.remoteWorkRequest.findMany(common) : Promise.resolve([]),
    run("overtime") ? prisma.overtimeRequest.findMany(common) : Promise.resolve([]),
    run("trip") ? prisma.businessTripRequest.findMany(common) : Promise.resolve([]),
  ]);

  // 유형별 summary 채우기. requestId는 유형 안에서 유일하므로 진행맵 조회를 위해 유형별로 id를 모은다.
  const base: Array<Omit<PendingRow, "waitingDays" | "stepTotal" | "approvedCount" | "nextApproverName" | "nextIsFinal">> = [];
  const push = (type: RequestType, r: CommonReq, summary: string) =>
    base.push({
      type,
      requestId: r.id,
      applicantName: r.user.name,
      applicantNo: r.user.employeeNo,
      applicantDept: r.user.department?.name ?? null,
      summary,
      reason: r.reason,
      createdAt: r.createdAt,
    });

  for (const r of leaves) push("leave", r, `${leaveTypeLabel(r.type)} (${rangeLabel(r.startDate, r.endDate)}) · ${r.days}일`);
  for (const r of corrs) {
    const parts = [r.requestedIn ? `출근 ${r.requestedIn}` : "", r.requestedOut ? `퇴근 ${r.requestedOut}` : ""].filter(Boolean).join(" · ");
    push("correction", r, `근태정정 (${mdHm(r.targetDate)})${parts ? ` ${parts}` : ""}`);
  }
  for (const r of outings) push("outing", r, `${outingKindLabel(r.kind)} (${mdHm(r.targetDate)} ${r.startTime}~${r.endTime})${r.place ? ` · ${r.place}` : ""}`);
  for (const r of remotes) push("remote", r, `재택근무 (${remoteRangeLabel(r.startDate, r.endDate)})`);
  for (const r of overtimes) push("overtime", r, `초과근무 (${mdHm(r.targetDate)} ${overtimeTimeLabel(r.startTime, r.endTime)})`);
  for (const r of trips) push("trip", r, `출장 (${tripRangeLabel(r.startDate, r.endDate)}) · ${r.destination}`);

  // 먼저 오래된 순 정렬 + 상한으로 자른다(여러 표를 합쳤으므로 전체 정렬 후 slice).
  //  · 진행상태(누구 차례) 조회는 "살아남은 행"에 대해서만 한다 — 버릴 최대 1500건까지 조회하지 않도록(결재이력과 동일 순서).
  base.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const kept = base.slice(0, limit);

  // 진행상태 일괄 조회 — 유형별로 requestId를 모아 한 번씩(잘라낸 뒤라 최대 limit건).
  const idsByType = new Map<RequestType, string[]>();
  for (const r of kept) {
    const arr = idsByType.get(r.type) ?? [];
    arr.push(r.requestId);
    idsByType.set(r.type, arr);
  }
  const progressByType = new Map<RequestType, Map<string, ApprovalProgress>>();
  await Promise.all(
    [...idsByType.entries()].map(async ([t, ids]) => {
      progressByType.set(t, await getApprovalProgressMap(companyId, t, ids));
    }),
  );

  return kept.map((r) => {
    const prog = progressByType.get(r.type)?.get(r.requestId);
    return {
      ...r,
      waitingDays: waitingDaysBetween(r.createdAt, now),
      stepTotal: prog?.total ?? 0, // 0 = 결재선 없음 → 관리자 승인 대기
      approvedCount: prog?.approvedCount ?? 0,
      nextApproverName: prog?.nextApproverName ?? null,
      nextIsFinal: prog?.nextIsFinal ?? false,
    };
  });
}
