// 초과근무 승인(관리자 전용) — 대기 목록 승인/반려 + 처리 내역. 기간 달력 + 통합검색. (외출외근 승인 화면 패턴)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { OvertimeApprovalsClient, type OvertimeRow } from "./OvertimeApprovalsClient";
import { overtimeStatusLabel, overtimeTimeLabel } from "@/lib/overtime-request";
import { parseAnchor, toISODate } from "@/lib/period";
import { getApprovalProgressMap, approvalProgressLabel, selfApprovalNotice, isSelfApprovalBlocked } from "@/lib/approval-server";
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
  // 회사에 나 말고 다른 관리자가 있는가(= 내 신청은 그 사람이 처리해야 한다).
  const otherAdminsExist = await isSelfApprovalBlocked(me, me.id);
  const progressLabel = (id: string, isMine: boolean): string | undefined => {
    // 문구는 lib/approval-server.ts 한 곳에서 만든다(6개 승인화면이 같은 말을 하도록).
    //  · 내 신청이면 "승인을 눌러도 통과되지 않는 이유"를 함께 붙인다(M-11).
    const base = approvalProgressLabel(progressMap.get(id));
    const notice = selfApprovalNotice(progressMap.get(id), isMine, otherAdminsExist);
    if (!notice) return base;
    return base ? `${base} · ${notice}` : notice;
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
      progress: progressLabel(r.id, r.userId === me.id),
      attachments: attMap.get(r.id) ?? [],
      search: [r.user.name, r.user.employeeNo ?? "", dateLabel, reason, statusLabel].join(" ").toLowerCase(),
    };
  };

  return (
    <AppShell user={me} active="overtime-approvals" title="초과근무 승인" subtitle={me.company.name}>
      {/* ⚠️ [초과근무 현황]과 짝이다(2026-08-23). 여기는 **신청서**를 처리하는 곳이라,
             신청 없이 늦게까지 일한 사람은 이 목록에 나오지 않는다. 주 52시간 준수는 그쪽에서 본다. */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 14, wordBreak: "keep-all", lineHeight: 1.6 }}>
        여기는 직원이 <b>미리 낸 신청</b>을 처리하는 곳입니다.
        실제 근무시간 기준 주 52시간 현황은 <Link href="/overtime-manage" style={{ color: "var(--primary)", fontWeight: 700 }}>[근태 운영 → 초과근무 현황]</Link>에서 봅니다.
      </div>
      <OvertimeApprovalsClient pending={pendingReqs.map(toRow)} decided={decidedReqs.map(toRow)} from={fromISO} to={toISO} todayISO={todayISO} />
    </AppShell>
  );
}
