// 결재선(부서장 자동 결재선) DB 로직 — 결재자 해석·단계 진행·결재함 조회.
//  · 순수 계산은 lib/approval.ts, 여기선 DB 접근(회사격리 필수).
//  · 설계: docs/04_architecture/결재선_설계.md
import { prisma } from "@/lib/db";
import { buildApprovalChain, nextPendingStep, isChainComplete, type DeptNode } from "@/lib/approval";

export type RequestType = "leave" | "correction";

type Me = { id: string; role: string; companyId: string };

// 신청자의 결재선(결재자 userId 배열)을 계산. 빈 배열이면 결재선 없음(관리자 단일 승인 폴백).
export async function resolveApproverChain(
  companyId: string,
  applicantUserId: string,
  applicantDeptId: string | null,
  stepCount: number,
): Promise<string[]> {
  const depts = await prisma.department.findMany({
    where: { companyId },
    select: { id: true, headUserId: true, parentId: true, deputyUserId: true },
  });
  const map = new Map<string, DeptNode>(depts.map((d) => [d.id, d]));
  return buildApprovalChain(applicantUserId, applicantDeptId, map, stepCount).approverUserIds;
}

// 신청 생성 직후 결재선(ApprovalStep들)을 만든다. deptline이 아니거나 결재자가 없으면 만들지 않는다(=단일 승인).
export async function createApprovalStepsIfNeeded(
  company: { approvalMode: string; approvalStepCount: number } | null,
  companyId: string,
  applicantUserId: string,
  applicantDeptId: string | null,
  requestType: RequestType,
  requestId: string,
): Promise<void> {
  if (!company || company.approvalMode !== "deptline") return;
  const approvers = await resolveApproverChain(companyId, applicantUserId, applicantDeptId, company.approvalStepCount);
  if (approvers.length === 0) return; // 결재자 없음 → 관리자 단일 승인
  await prisma.approvalStep.createMany({
    data: approvers.map((uid, i) => ({
      companyId,
      requestType,
      requestId,
      stepOrder: i + 1,
      approverUserId: uid,
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
export async function advanceApproval(
  me: Me,
  requestType: RequestType,
  requestId: string,
  action: "approve" | "reject",
): Promise<AdvanceResult> {
  const steps = await prisma.approvalStep.findMany({
    where: { companyId: me.companyId, requestType, requestId },
    orderBy: { stepOrder: "asc" },
  });

  // 결재선 없음(단일 승인/폴백) → 관리자만.
  if (steps.length === 0) {
    if (me.role !== "admin") return "denied";
    return action === "approve" ? "approved" : "rejected";
  }

  const cur = nextPendingStep(steps);
  if (!cur) return "denied"; // 이미 완료/반려된 체인

  // 권한: 현재 단계 결재자 본인 또는 관리자(오버라이드).
  const canAct = me.role === "admin" || cur.approverUserId === me.id;
  if (!canAct) return "denied";

  const now = new Date();

  if (action === "reject") {
    await prisma.approvalStep.update({ where: { id: cur.id }, data: { status: "rejected", decidedAt: now } });
    return "rejected";
  }

  // 관리자 오버라이드: 남은 대기 단계 전부 승인 → 즉시 완료.
  if (me.role === "admin") {
    await prisma.approvalStep.updateMany({
      where: { companyId: me.companyId, requestType, requestId, status: "pending" },
      data: { status: "approved", decidedAt: now },
    });
    return "approved";
  }

  // 부서장: 현재 단계만 승인 → 완료 여부 판정.
  await prisma.approvalStep.update({ where: { id: cur.id }, data: { status: "approved", decidedAt: now } });
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
        createdAt: lv.createdAt,
        summary: `휴가 신청 (${s === e ? s : `${s}~${e}`})`,
        detail: lv.reason ?? "",
      });
    } else {
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
        createdAt: c.createdAt,
        summary: `근태정정 (${d}) ${parts}`,
        detail: c.reason,
      });
    }
  }
  return items;
}
