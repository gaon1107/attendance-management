// 결재선(부서장 자동 결재선) DB 로직 — 결재자 해석·단계 진행·결재함 조회.
//  · 순수 계산은 lib/approval.ts, 여기선 DB 접근(회사격리 필수).
//  · 설계: docs/04_architecture/결재선_설계.md
import { cache } from "react";
import { prisma } from "@/lib/db";
import { buildApprovalChain, nextPendingStep, isChainComplete, isChainRejected, type DeptNode, type ChainApprover } from "@/lib/approval";
import { outingKindLabel } from "@/lib/outing";
import { remoteRangeLabel } from "@/lib/remote";
import { overtimeTimeLabel } from "@/lib/overtime-request";
import { tripRangeLabel } from "@/lib/trip";

export type RequestType = "leave" | "correction" | "outing" | "remote" | "overtime" | "trip";

// 결재선 대상 신청 유형 목록(런타임). custom 결재선 저장·검증에서 화이트리스트로 사용.
export const REQUEST_TYPES: readonly RequestType[] = ["leave", "correction", "outing", "remote", "overtime", "trip"];
export function isRequestType(t: string): t is RequestType {
  return (REQUEST_TYPES as readonly string[]).includes(t);
}

// custom 결재선 1건당 최대 결재자 수(대리~대표까지 담기게 넉넉히).
export const MAX_APPROVERS = 8;

type Me = { id: string; role: string; companyId: string };

// 직급 상급자 후보 범위 = "나보다 직급 높은 사람" 중,
//   ① 같은 부서(내 팀 상급자: 대리→과장→부장)  또는  ② 내 부서 최고 직급보다 높은 전사 임원(부장 위: 상무→전무→대표).
//  · 조직도(부서장/상위부서) 없이 직급만으로 결재선을 짠다(직급 단일 모델). 직원·부서장 모두 이 후보에서 직접 고른다.
type Scope = { myLevel: number; deptMax: number; departmentId: string | null };
async function candidateScope(companyId: string, applicantUserId: string): Promise<Scope | null> {
  const me = await prisma.user.findFirst({
    where: { id: applicantUserId, companyId },
    select: { departmentId: true, jobGrade: { select: { level: true } } },
  });
  if (!me?.jobGrade) return null; // 직급 미지정이면 상급자 판별 불가
  let deptMax = me.jobGrade.level;
  if (me.departmentId) {
    const top = await prisma.user.findFirst({
      where: { companyId, deactivatedAt: null, departmentId: me.departmentId, jobGradeId: { not: null } },
      orderBy: { jobGrade: { level: "desc" } },
      select: { jobGrade: { select: { level: true } } },
    });
    if (top?.jobGrade) deptMax = Math.max(deptMax, top.jobGrade.level);
  }
  return { myLevel: me.jobGrade.level, deptMax, departmentId: me.departmentId };
}
// "유효 상급자 후보" Prisma where 조각 — companyId·재직 등과 AND로 합쳐 쓴다.
function candidateWhere(scope: Scope) {
  const sameDept = scope.departmentId ? [{ departmentId: scope.departmentId }] : [];
  return {
    AND: [
      { jobGrade: { level: { gt: scope.myLevel } } }, // 나보다 상급 직급
      { OR: [...sameDept, { jobGrade: { level: { gt: scope.deptMax } } }] }, // 같은 부서 OR 내 부서 최고직급 위(임원)
    ],
  };
}

// custom 결재선 편집용 후보 목록 — "나보다 직급 높은 상급자"(같은 부서 팀 상급자 + 내 부서 최고직급 위 전사 임원).
//  · 직급 단일 모델: 직원(사원→대리→과장→부장)도 부서장(→상무→전무→대표)도 이 후보에서 직접 고른다. 조직도 불필요.
//  · 내부통제: 나보다 낮거나 같은 직급은 후보에 안 나옴 → 동료/부하 상호지정 원천 차단.
//  · 신청자가 직급 미지정이면 후보 0명 → 결재선 설정 불가(관리자 단독 승인 폴백).
export type LineCandidate = { id: string; name: string; employeeNo: string | null; deptName: string | null; gradeName: string | null };
export async function listApprovalCandidates(companyId: string, excludeUserId: string): Promise<LineCandidate[]> {
  const scope = await candidateScope(companyId, excludeUserId);
  if (!scope) return []; // 직급 미지정 → 고를 상급자 없음
  const users = await prisma.user.findMany({
    where: {
      companyId,
      deactivatedAt: null,
      id: { not: excludeUserId },
      ...candidateWhere(scope),
    },
    select: { id: true, name: true, employeeNo: true, department: { select: { name: true } }, jobGrade: { select: { name: true } } },
    orderBy: [{ jobGrade: { level: "asc" } }, { name: "asc" }], // 낮은 상급자부터(대리→과장→…→대표)
  });
  return users.map((u) => ({ id: u.id, name: u.name, employeeNo: u.employeeNo, deptName: u.department?.name ?? null, gradeName: u.jobGrade?.name ?? null }));
}

// custom 모드: 저장된 개인 결재선(ApprovalLineTemplate)을 로드해 "실제로 결재 가능한" 결재자 id 순서를 돌려준다.
//  · 검증: 같은 회사 재직자 + 본인 제외 + 중복 제거 + 순서 보존 + 최대 MAX_APPROVERS.
//  · 저장 후 결재자가 퇴사(deactivatedAt)했으면 자동으로 건너뛴다. 결과 빈 배열이면 관리자 단일 승인 폴백.
export async function resolveCustomApprovers(
  companyId: string,
  applicantUserId: string,
  requestType: RequestType,
): Promise<string[]> {
  const tpl = await prisma.approvalLineTemplate.findFirst({
    where: { companyId, userId: applicantUserId, requestType },
    select: { approverIdsCsv: true },
  });
  if (!tpl || !tpl.approverIdsCsv.trim()) return [];
  const raw = tpl.approverIdsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  return filterActiveApprovers(companyId, applicantUserId, raw);
}

// 결재자 id 목록을 "현재 유효한 상급자"만 남긴다: 후보 규칙(직급 상급자)·본인 제외·중복 제거·순서 보존·상한.
//  · 저장(saveApprovalLine)·신청(resolveCustomApprovers) 양쪽 공용 → 후보 화면(listApprovalCandidates)과 같은 규칙을
//    선택·실행 모두에 강제(폼 위조로 동급·하급·범위 밖 지정 차단).
//  · 신청자 직급 미지정이면 0명. 저장 후 결재자가 퇴사/직급하락/부서이동하면 자동 제외(안전 폴백).
export async function filterActiveApprovers(
  companyId: string,
  applicantUserId: string,
  ids: string[],
): Promise<string[]> {
  const uniq: string[] = [];
  const seen = new Set<string>([applicantUserId]); // 본인 제외
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  if (uniq.length === 0) return [];
  const scope = await candidateScope(companyId, applicantUserId);
  if (!scope) return [];
  // 같은 회사·재직 + 직급 상급자 범위(같은 부서 팀 상급자 + 부서최고직급 위 임원)인 결재자만 남긴다.
  const valid = await prisma.user.findMany({
    where: { id: { in: uniq }, companyId, deactivatedAt: null, ...candidateWhere(scope) },
    select: { id: true },
  });
  const validSet = new Set(valid.map((u) => u.id));
  return uniq.filter((id) => validSet.has(id)).slice(0, MAX_APPROVERS);
}

// 신청자의 결재선(결재자 목록)을 계산. 빈 배열이면 결재선 없음(관리자 단일 승인 폴백).
//  · 반환 각 원소 isFinal=true면 전결권자(그 단계에서 종결). 전결권자를 만나면 배열이 그 사람에서 끝난다.
export async function resolveApproverChain(
  companyId: string,
  applicantUserId: string,
  applicantDeptId: string | null,
  stepCount: number,
): Promise<ChainApprover[]> {
  const depts = await prisma.department.findMany({
    where: { companyId },
    select: { id: true, headUserId: true, parentId: true, deputyUserId: true, finalApproval: true },
  });
  const map = new Map<string, DeptNode>(depts.map((d) => [d.id, d]));
  return buildApprovalChain(applicantUserId, applicantDeptId, map, stepCount).approvers;
}

// 신청 생성 직후 결재선(ApprovalStep들)을 만든다. 결재자가 없으면 만들지 않는다(=관리자 단일 승인).
//  · single: 결재선 없음(관리자 단독).
//  · deptline: 부서장 자동 결재선(전결권자 단계엔 isFinal 저장).
//  · custom(직급 단일): 직원이 직급 상급자(같은 부서 팀 상급자 + 부서최고직급 위 임원) 중 직접 고른 순서 그대로.
//      - 직원(사원→대리→과장→부장)도 부서장(→상무→전무→대표)도 같은 방식으로 고른다. 조직도 자동부는 없다.
//      - 미설정(선택 0)·직급 미지정 → 단계 미생성 = 관리자 단독 승인 폴백. 마지막 단계 승인=최종 확정(isChainComplete).
export async function createApprovalStepsIfNeeded(
  company: { approvalMode: string; approvalStepCount: number } | null,
  companyId: string,
  applicantUserId: string,
  applicantDeptId: string | null,
  requestType: RequestType,
  requestId: string,
): Promise<void> {
  if (!company) return;

  if (company.approvalMode === "custom") {
    // 직원이 고른 상급자 결재선(순서 그대로). 유효성(직급 상급자·재직)은 resolveCustomApprovers가 재검증.
    const ids = await resolveCustomApprovers(companyId, applicantUserId, requestType);
    if (ids.length === 0) return; // 미설정/유효 0 → 관리자 단독 승인 폴백
    await prisma.approvalStep.createMany({
      data: ids.map((uid, i) => ({
        companyId,
        requestType,
        requestId,
        stepOrder: i + 1,
        approverUserId: uid,
        // custom은 순번 결재(전결 개념 없음) → isFinal=false. 최종 확정은 전원 승인(isChainComplete)으로 처리.
        isFinal: false,
      })),
    });
    return;
  }

  if (company.approvalMode !== "deptline") return;
  const approvers = await resolveApproverChain(companyId, applicantUserId, applicantDeptId, company.approvalStepCount);
  if (approvers.length === 0) return; // 결재자 없음 → 관리자 단일 승인
  await prisma.approvalStep.createMany({
    data: approvers.map((a, i) => ({
      companyId,
      requestType,
      requestId,
      stepOrder: i + 1,
      approverUserId: a.userId,
      isFinal: a.isFinal,
    })),
  });
}

// 결재 단계 진행 판정 결과.
//  · "approved"  = 체인 완료 → 원본을 승인 확정하라
//  · "rejected"  = 반려 → 원본을 반려 확정하라
//  · "advanced"  = 이번 단계만 승인, 다음 결재자 대기(원본은 pending 유지)
//  · "denied"    = 권한 없음/유효하지 않음(아무 것도 하지 말라)
export type AdvanceResult = "approved" | "rejected" | "advanced" | "denied";

// 한 신청에 대해 현재 사용자가 승인/반려를 시도한다. 회사격리·권한(현재 단계 결재자 또는 관리자)을 강제한다.
//  · comment: 결재자 결정 사유(선택). 이번에 처리하는 단계(들)에 저장한다. 미전달이면 기존과 동일(무영향).
export async function advanceApproval(
  me: Me,
  requestType: RequestType,
  requestId: string,
  action: "approve" | "reject",
  comment?: string,
): Promise<AdvanceResult> {
  const note = comment && comment.trim() ? comment.trim() : null;
  const steps = await prisma.approvalStep.findMany({
    where: { companyId: me.companyId, requestType, requestId },
    orderBy: { stepOrder: "asc" },
  });

  // 결재선 없음(단일 승인/폴백) → 관리자만.
  if (steps.length === 0) {
    if (me.role !== "admin") return "denied";
    return action === "approve" ? "approved" : "rejected";
  }

  // 이미 반려된 단계가 있으면 결과는 '반려'로 확정됨. 뒷 단계가 pending이어도(반려는 현재 단계만 마킹)
  // 결과는 바뀌지 않으므로, 부분 실패 후 재시도 시 원본을 반려 확정하도록 그대로 반환한다(멱등 복구).
  if (isChainRejected(steps)) return "rejected";

  const cur = nextPendingStep(steps);
  if (!cur) {
    // 대기 단계 없음 + 반려 없음 = 전 단계 승인 완료. 부분 실패(원본 status 반영 실패) 후
    // 재시도 시 원본을 승인 확정할 수 있도록 그대로 돌려준다(멱등 복구).
    if (isChainComplete(steps)) return "approved";
    return "denied";
  }

  // 권한: 현재 단계 결재자 본인 또는 관리자(오버라이드).
  const canAct = me.role === "admin" || cur.approverUserId === me.id;
  if (!canAct) return "denied";

  const now = new Date();

  if (action === "reject") {
    await prisma.approvalStep.update({ where: { id: cur.id }, data: { status: "rejected", decidedAt: now, comment: note } });
    return "rejected";
  }

  // 관리자 오버라이드: 남은 대기 단계 전부 승인 → 즉시 완료(단일 원자 쓰기).
  //  · 관리자 사유는 호출 액션이 원본 decisionComment에 미러한다(신청자 표시의 원천). 단계 comment엔 별도 기록하지 않음
  //    — 타 부서장 소유 단계에 관리자 글을 귀속시키지 않고, 비원자적 2차 쓰기도 없앤다.
  if (me.role === "admin") {
    await prisma.approvalStep.updateMany({
      where: { companyId: me.companyId, requestType, requestId, status: "pending" },
      data: { status: "approved", decidedAt: now },
    });
    return "approved";
  }

  // 부서장: 현재 단계만 승인 → 완료 여부 판정.
  await prisma.approvalStep.update({ where: { id: cur.id }, data: { status: "approved", decidedAt: now, comment: note } });
  const updated = steps.map((s) => (s.id === cur.id ? { ...s, status: "approved" } : s));
  return isChainComplete(updated) ? "approved" : "advanced";
}

// 신청 취소/삭제 시 남은 결재 단계를 정리(고아 방지).
export async function deleteApprovalSteps(companyId: string, requestType: RequestType, requestId: string): Promise<void> {
  await prisma.approvalStep.deleteMany({ where: { companyId, requestType, requestId } });
}

// 결재함용 한 항목.
export type ApprovalInboxItem = {
  type: RequestType;
  requestId: string;
  applicantName: string;
  applicantNo: string | null;
  stepOrder: number;
  totalSteps: number;
  isFinal: boolean; // 내 현재 단계가 전결 종결 단계인지(전결권자) → 결재함에 "전결" 표시. 승인 시 바로 최종 확정.
  createdAt: Date;
  // 표시용 요약(휴가/근태정정)
  summary: string;
  detail: string;
};

// 로그인한 사용자가 "지금 결재할 차례"인 대기 항목만 모은다(앞 단계가 끝난 것).
export async function listMyApprovals(me: Me): Promise<ApprovalInboxItem[]> {
  const mySteps = await prisma.approvalStep.findMany({
    where: { companyId: me.companyId, approverUserId: me.id, status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  const items: ApprovalInboxItem[] = [];
  for (const step of mySteps) {
    const siblings = await prisma.approvalStep.findMany({
      where: { companyId: me.companyId, requestType: step.requestType, requestId: step.requestId },
      orderBy: { stepOrder: "asc" },
    });
    const cur = nextPendingStep(siblings);
    if (!cur || cur.id !== step.id) continue; // 아직 내 차례가 아님(앞 단계 대기 중)

    if (step.requestType === "leave") {
      const lv = await prisma.leaveRequest.findFirst({
        where: { id: step.requestId, companyId: me.companyId, status: "pending" },
        include: { user: { select: { name: true, employeeNo: true } } },
      });
      if (!lv) continue; // 취소/처리됨
      const s = lv.startDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      const e = lv.endDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      items.push({
        type: "leave",
        requestId: lv.id,
        applicantName: lv.user.name,
        applicantNo: lv.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: lv.createdAt,
        summary: `휴가 신청 (${s === e ? s : `${s}~${e}`})`,
        detail: lv.reason ?? "",
      });
    } else if (step.requestType === "correction") {
      const c = await prisma.attendanceCorrection.findFirst({
        where: { id: step.requestId, companyId: me.companyId, status: "pending" },
        include: { user: { select: { name: true, employeeNo: true } } },
      });
      if (!c) continue;
      const d = c.targetDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      const parts = [c.requestedIn ? `출근 ${c.requestedIn}` : "", c.requestedOut ? `퇴근 ${c.requestedOut}` : ""].filter(Boolean).join(" · ");
      items.push({
        type: "correction",
        requestId: c.id,
        applicantName: c.user.name,
        applicantNo: c.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: c.createdAt,
        summary: `근태정정 (${d}) ${parts}`,
        detail: c.reason,
      });
    } else if (step.requestType === "outing") {
      const o = await prisma.outingRequest.findFirst({
        where: { id: step.requestId, companyId: me.companyId, status: "pending" },
        include: { user: { select: { name: true, employeeNo: true } } },
      });
      if (!o) continue;
      const d = o.targetDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      const kindLabel = outingKindLabel(o.kind);
      items.push({
        type: "outing",
        requestId: o.id,
        applicantName: o.user.name,
        applicantNo: o.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: o.createdAt,
        summary: `${kindLabel} 신청 (${d} ${o.startTime}~${o.endTime})${o.place ? ` · ${o.place}` : ""}`,
        detail: o.reason ?? "",
      });
    } else if (step.requestType === "remote") {
      const rw = await prisma.remoteWorkRequest.findFirst({
        where: { id: step.requestId, companyId: me.companyId, status: "pending" },
        include: { user: { select: { name: true, employeeNo: true } } },
      });
      if (!rw) continue;
      items.push({
        type: "remote",
        requestId: rw.id,
        applicantName: rw.user.name,
        applicantNo: rw.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: rw.createdAt,
        summary: `재택근무 신청 (${remoteRangeLabel(rw.startDate, rw.endDate)})`,
        detail: rw.reason ?? "",
      });
    } else if (step.requestType === "overtime") {
      const ot = await prisma.overtimeRequest.findFirst({
        where: { id: step.requestId, companyId: me.companyId, status: "pending" },
        include: { user: { select: { name: true, employeeNo: true } } },
      });
      if (!ot) continue;
      const d = ot.targetDate.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
      items.push({
        type: "overtime",
        requestId: ot.id,
        applicantName: ot.user.name,
        applicantNo: ot.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: ot.createdAt,
        summary: `초과근무 신청 (${d} ${overtimeTimeLabel(ot.startTime, ot.endTime)})`,
        detail: ot.reason ?? "",
      });
    } else if (step.requestType === "trip") {
      const tp = await prisma.businessTripRequest.findFirst({
        where: { id: step.requestId, companyId: me.companyId, status: "pending" },
        include: { user: { select: { name: true, employeeNo: true } } },
      });
      if (!tp) continue;
      items.push({
        type: "trip",
        requestId: tp.id,
        applicantName: tp.user.name,
        applicantNo: tp.user.employeeNo,
        stepOrder: step.stepOrder,
        totalSteps: siblings.length,
        isFinal: step.isFinal === true,
        createdAt: tp.createdAt,
        summary: `출장 신청 (${tripRangeLabel(tp.startDate, tp.endDate)}) · ${tp.destination}`,
        detail: tp.reason ?? "",
      });
    }
  }
  return items;
}

// 결재 라인 구성원인지(사이드바 [결재함] 메뉴 표시용). 실제 결재자 산정(buildApprovalChain:
// candidate = headUserId ?? deputyUserId)과 일치시킨다 → 부서장(headUserId)이거나,
// **부서장이 없는 부서의** 대결자(deputyUserId)면 true. 전결권자도 부서장이라 포함.
//  · 부서장+대결자가 둘 다 있으면 대결자는 실제 결재를 받지 못하므로(빈 결재함 방지) 제외.
//  · 회사격리 필수. React cache() → 한 요청 내 실제 조회 1회.
export const isApprovalLineMember = cache(async (companyId: string, userId: string): Promise<boolean> => {
  const n = await prisma.department.count({
    where: { companyId, OR: [{ headUserId: userId }, { headUserId: null, deputyUserId: userId }] },
  });
  return n > 0;
});

// 내가 지금 결재할 차례인 대기 건수(사이드바 배지·알림용). 배지용이라 원본 레코드·user join 없이
// 단계만으로 경량 집계(건수 K와 무관하게 최대 ~4쿼리). 결재자 아니면 첫 쿼리 빈 결과로 즉시 0.
// React cache() → 한 요청 내(사이드바가 여러 번 읽어도) 실제 집계 1회.
export const countMyPendingApprovals = cache(async (companyId: string, userId: string): Promise<number> => {
  const mySteps = await prisma.approvalStep.findMany({
    where: { companyId, approverUserId: userId, status: "pending" },
    select: { requestType: true, requestId: true, stepOrder: true },
  });
  if (mySteps.length === 0) return 0;

  const reqIds = [...new Set(mySteps.map((s) => s.requestId))];
  const siblings = await prisma.approvalStep.findMany({
    where: { companyId, requestId: { in: reqIds } },
    select: { requestType: true, requestId: true, stepOrder: true, status: true, approverUserId: true },
  });
  // 원본이 아직 pending인 신청만(반려·완료된 건 제외). 타입별 id 분리.
  const leaveIds = mySteps.filter((s) => s.requestType === "leave").map((s) => s.requestId);
  const corrIds = mySteps.filter((s) => s.requestType === "correction").map((s) => s.requestId);
  const outingIds = mySteps.filter((s) => s.requestType === "outing").map((s) => s.requestId);
  const remoteIds = mySteps.filter((s) => s.requestType === "remote").map((s) => s.requestId);
  const overtimeIds = mySteps.filter((s) => s.requestType === "overtime").map((s) => s.requestId);
  const tripIds = mySteps.filter((s) => s.requestType === "trip").map((s) => s.requestId);
  const [pendLeaves, pendCorrs, pendOutings, pendRemotes, pendOvertimes, pendTrips] = await Promise.all([
    leaveIds.length ? prisma.leaveRequest.findMany({ where: { id: { in: leaveIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    corrIds.length ? prisma.attendanceCorrection.findMany({ where: { id: { in: corrIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    outingIds.length ? prisma.outingRequest.findMany({ where: { id: { in: outingIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    remoteIds.length ? prisma.remoteWorkRequest.findMany({ where: { id: { in: remoteIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    overtimeIds.length ? prisma.overtimeRequest.findMany({ where: { id: { in: overtimeIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
    tripIds.length ? prisma.businessTripRequest.findMany({ where: { id: { in: tripIds }, companyId, status: "pending" }, select: { id: true } }) : Promise.resolve([]),
  ]);
  const pendingReqIds = new Set([...pendLeaves.map((x) => x.id), ...pendCorrs.map((x) => x.id), ...pendOutings.map((x) => x.id), ...pendRemotes.map((x) => x.id), ...pendOvertimes.map((x) => x.id), ...pendTrips.map((x) => x.id)]);

  let n = 0;
  for (const my of mySteps) {
    if (!pendingReqIds.has(my.requestId)) continue;
    const sib = siblings.filter((s) => s.requestType === my.requestType && s.requestId === my.requestId);
    const cur = nextPendingStep(sib);
    if (cur && cur.stepOrder === my.stepOrder && cur.approverUserId === userId) n++;
  }
  return n;
});

// 신청들의 결재 진행상황(진행표시용). requestId → {단계수·승인수·다음 결재자·반려 여부·다음이 전결권자인지}.
export type ApprovalProgress = { total: number; approvedCount: number; nextApproverName: string | null; rejected: boolean; nextIsFinal: boolean };

export async function getApprovalProgressMap(
  companyId: string,
  requestType: RequestType,
  requestIds: string[],
): Promise<Map<string, ApprovalProgress>> {
  const map = new Map<string, ApprovalProgress>();
  if (requestIds.length === 0) return map;

  const steps = await prisma.approvalStep.findMany({
    where: { companyId, requestType, requestId: { in: requestIds } },
    orderBy: { stepOrder: "asc" },
    select: { requestId: true, stepOrder: true, status: true, approverUserId: true, isFinal: true },
  });
  if (steps.length === 0) return map;

  // 다음 결재자 이름 해석(한 번에)
  const names = await prisma.user.findMany({
    where: { companyId, id: { in: [...new Set(steps.map((s) => s.approverUserId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((u) => [u.id, u.name]));

  const byReq = new Map<string, typeof steps>();
  for (const s of steps) {
    const arr = byReq.get(s.requestId) ?? [];
    arr.push(s);
    byReq.set(s.requestId, arr);
  }
  for (const [rid, ss] of byReq) {
    const next = ss.find((s) => s.status === "pending");
    map.set(rid, {
      total: ss.length,
      approvedCount: ss.filter((s) => s.status === "approved").length,
      nextApproverName: next ? (nameOf.get(next.approverUserId) ?? null) : null,
      rejected: ss.some((s) => s.status === "rejected"),
      nextIsFinal: next ? next.isFinal === true : false, // 다음 결재자가 전결권자면 그 승인이 최종
    });
  }
  return map;
}
