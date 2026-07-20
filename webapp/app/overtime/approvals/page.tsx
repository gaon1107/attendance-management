// 초과근무 승인(관리자 전용) — 대기 목록 승인/반려 + 처리 내역. 기간 달력 + 통합검색. (외출외근 승인 화면 패턴)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { OvertimeApprovalsClient, type OvertimeRow } from "./OvertimeApprovalsClient";
import { overtimeStatusLabel, overtimeTimeLabel } from "@/lib/overtime-request";
import { parseAnchor, toISODate } from "@/lib/period";
import { getApprovalProgressMap } from "@/lib/approval-server";
import { getAttachmentsMap } from "@/lib/request-attachment-server";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

export default async function OvertimeApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const todayISO = toISODate(new Date());
  const now = new Date();
  const defFrom = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const normISO = (s: string | undefined, fb: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00").getTime())) return s;
    return fb;
  };
  const fromISO = normISO(sp.from, defFrom);
  let toISO = normISO(sp.to, defTo);
  if (toISO < fromISO) toISO = fromISO;
  const start = parseAnchor(fromISO);
  start.setHours(0, 0, 0, 0);
  const endDay = parseAnchor(toISO);
  endDay.setHours(0, 0, 0, 0);
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + 92);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  const pendingReqs = await prisma.overtimeRequest.findMany({
    where: { companyId: me.companyId, status: "pending" },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const decidedReqs = await prisma.overtimeRequest.findMany({
    where: { companyId: me.companyId, status: { not: "pending" }, decidedAt: { gte: start, lt: end } },
    include: { user: true },
    orderBy: { decidedAt: "desc" },
  });

  const progressMap =
    (me.company.approvalMode === "deptline" || me.company.approvalMode === "custom")
      ? await getApprovalProgressMap(me.companyId, "overtime", pendingReqs.map((r) => r.id))
      : new Map();
  const progressLabel = (id: string): string | undefined => {
    const p = progressMap.get(id);
    if (!p) return undefined;
    if (p.rejected) return "부서장 반려됨";
    return `부서장 결재 ${p.approvedCount}/${p.total}${p.nextApproverName ? ` · 다음 ${p.nextApproverName}` : ""}`;
  };

  const attMap = await getAttachmentsMap(me.companyId, "overtime", pendingReqs.map((r) => r.id));

  const toRow = (r: (typeof pendingReqs)[number]): OvertimeRow => {
    const dateLabel = ymd(r.targetDate);
    const timeLabel = overtimeTimeLabel(r.startTime, r.endTime);
    const statusLabel = overtimeStatusLabel(r.status);
    const reason = r.reason || "";
    return {
      id: r.id,
      name: r.user.name,
      employeeNo: r.user.employeeNo,
      initial: r.user.name.slice(0, 1),
      dateLabel,
      timeLabel,
      reason,
      status: r.status,
      statusLabel,
      progress: progressLabel(r.id),
      attachments: attMap.get(r.id) ?? [],
      search: [r.user.name, r.user.employeeNo ?? "", dateLabel, reason, statusLabel].join(" ").toLowerCase(),
    };
  };

  return (
    <AppShell user={me} active="overtime-approvals" title="초과근무 승인" subtitle={me.company.name}>
      <OvertimeApprovalsClient pending={pendingReqs.map(toRow)} decided={decidedReqs.map(toRow)} from={fromISO} to={toISO} todayISO={todayISO} />
    </AppShell>
  );
}
