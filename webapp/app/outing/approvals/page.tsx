// 외출/외근 승인(관리자 전용) — 대기 목록 승인/반려 + 처리 내역. 기간 달력 + 통합검색. (휴가 승인 화면 패턴)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { OutingApprovalsClient, type OutingRow } from "./OutingApprovalsClient";
import { outingKindLabel, outingStatusLabel } from "@/lib/outing";
import { parseAnchor, toISODate } from "@/lib/period";
import { getApprovalProgressMap } from "@/lib/approval-server";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

export default async function OutingApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  // 기본 기간: 이번 달. 이상값은 오늘/기본으로 대체.
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
  // 과도한 전량 로드 방지: 최대 92일(초과 시 잘라 표시 종료일도 맞춤)
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + 92);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  // 대기: 항상 전체. 처리 내역: "처리한 시점(decidedAt)"이 선택 기간에 드는 것만.
  const pendingReqs = await prisma.outingRequest.findMany({
    where: { companyId: me.companyId, status: "pending" },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const decidedReqs = await prisma.outingRequest.findMany({
    where: { companyId: me.companyId, status: { not: "pending" }, decidedAt: { gte: start, lt: end } },
    include: { user: true },
    orderBy: { decidedAt: "desc" },
  });

  // 부서장 결재선을 켠 회사면, 대기 건의 결재 진행상황을 함께 보여 관리자가 조기 승인하지 않도록 안내.
  const progressMap =
    me.company.approvalMode === "deptline"
      ? await getApprovalProgressMap(me.companyId, "outing", pendingReqs.map((r) => r.id))
      : new Map();
  const progressLabel = (id: string): string | undefined => {
    const p = progressMap.get(id);
    if (!p) return undefined;
    if (p.rejected) return "부서장 반려됨";
    return `부서장 결재 ${p.approvedCount}/${p.total}${p.nextApproverName ? ` · 다음 ${p.nextApproverName}` : ""}`;
  };

  const toRow = (r: (typeof pendingReqs)[number]): OutingRow => {
    const kindLabel = outingKindLabel(r.kind);
    const dateLabel = ymd(r.targetDate);
    const timeLabel = `${r.startTime}~${r.endTime}`;
    const statusLabel = outingStatusLabel(r.status);
    const place = r.place || "";
    const reason = r.reason || "";
    return {
      id: r.id,
      name: r.user.name,
      employeeNo: r.user.employeeNo,
      initial: r.user.name.slice(0, 1),
      kindLabel,
      dateLabel,
      timeLabel,
      place,
      reason,
      status: r.status,
      statusLabel,
      progress: progressLabel(r.id),
      search: [r.user.name, r.user.employeeNo ?? "", kindLabel, dateLabel, place, reason, statusLabel].join(" ").toLowerCase(),
    };
  };

  return (
    <AppShell user={me} active="outing-approvals" title="외출/외근 승인" subtitle={me.company.name}>
      <OutingApprovalsClient pending={pendingReqs.map(toRow)} decided={decidedReqs.map(toRow)} from={fromISO} to={toISO} todayISO={todayISO} />
    </AppShell>
  );
}
