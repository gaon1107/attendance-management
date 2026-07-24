// 밀린 결재 현황 (관리자 전용) — 회사 전체의 아직 결정 안 난 결재(6종)를 한 표로 모아
// "며칠째 · 지금 누구 차례에서 막혔나"로 보여준다. 읽기 전용(Phase 1). 대리 처리는 Phase 2.
//  · 목적: "신청했는데 무한정 승인이 안 나는" 문제를 관리자가 한눈에 파악.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { listPendingApprovals, PENDING_LIMIT } from "@/lib/pending-approvals";
import type { RequestType } from "@/lib/approval-server";
import { PendingApprovalsClient, type PendingClientRow } from "./PendingApprovalsClient";

const TYPES: RequestType[] = ["leave", "correction", "outing", "remote", "overtime", "trip"];
const TYPE_LABEL: Record<RequestType, string> = { leave: "휴가", correction: "근태정정", outing: "외출/외근", remote: "재택근무", overtime: "초과근무", trip: "출장" };

function ymdhm(d: Date): string {
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function PendingApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const typeF: RequestType | "all" = TYPES.includes(sp.type as RequestType) ? (sp.type as RequestType) : "all";

  const rows = await listPendingApprovals(me.companyId, { type: typeF });
  const limitReached = rows.length >= PENDING_LIMIT;

  const clientRows: PendingClientRow[] = rows.map((r) => ({
    key: `${r.type}:${r.requestId}`,
    requestId: r.requestId,
    type: r.type,
    createdAtText: ymdhm(r.createdAt),
    waitingDays: r.waitingDays,
    applicantName: r.applicantName,
    applicantNo: r.applicantNo,
    applicantDept: r.applicantDept,
    summary: r.summary,
    reason: r.reason,
    stepTotal: r.stepTotal,
    approvedCount: r.approvedCount,
    nextApproverName: r.nextApproverName,
    nextIsFinal: r.nextIsFinal,
    // 통합검색 대상: 화면 표시값 결합(소문자).
    search: [TYPE_LABEL[r.type], r.applicantName, r.applicantNo, r.applicantDept, r.summary, r.reason, r.nextApproverName]
      .filter(Boolean).join(" ").toLowerCase(),
  }));

  return (
    <AppShell user={me} active="pending-approvals" title="밀린 결재" subtitle={me.company.name}>
      <PendingApprovalsClient rows={clientRows} type={typeF} limitReached={limitReached} pendingLimit={PENDING_LIMIT} />
    </AppShell>
  );
}
