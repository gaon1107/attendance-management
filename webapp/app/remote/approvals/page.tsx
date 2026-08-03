// 재택근무 승인(관리자 전용) — 대기 목록 승인/반려 + 처리 내역. 기간 달력 + 통합검색. (휴가 승인 화면 패턴)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { RemoteApprovalsClient, type RemoteRow } from "./RemoteApprovalsClient";
import { remoteStatusLabel, remoteRangeLabel } from "@/lib/remote";
import { parseAnchor, toISODate } from "@/lib/period";
import { getApprovalProgressMap, approvalProgressLabel, selfApprovalNotice, isSelfApprovalBlocked } from "@/lib/approval-server";
import { getAttachmentsMap } from "@/lib/request-attachment-server";

export default async function RemoteApprovalsPage({
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

  const pendingReqs = await prisma.remoteWorkRequest.findMany({
    where: { companyId: me.companyId, status: "pending" },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const decidedReqs = await prisma.remoteWorkRequest.findMany({
    where: { companyId: me.companyId, status: { not: "pending" }, decidedAt: { gte: start, lt: end } },
    include: { user: true },
    orderBy: { decidedAt: "desc" },
  });

  const progressMap =
    (me.company.approvalMode === "deptline" || me.company.approvalMode === "custom")
      ? await getApprovalProgressMap(me.companyId, "remote", pendingReqs.map((r) => r.id))
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

  const attMap = await getAttachmentsMap(me.companyId, "remote", pendingReqs.map((r) => r.id));

  const toRow = (r: (typeof pendingReqs)[number]): RemoteRow => {
    const rl = remoteRangeLabel(r.startDate, r.endDate);
    const statusLabel = remoteStatusLabel(r.status);
    const reason = r.reason || "";
    return {
      id: r.id,
      name: r.user.name,
      employeeNo: r.user.employeeNo,
      initial: r.user.name.slice(0, 1),
      rangeLabel: rl,
      reason,
      status: r.status,
      statusLabel,
      progress: progressLabel(r.id, r.userId === me.id),
      attachments: attMap.get(r.id) ?? [],
      search: [r.user.name, r.user.employeeNo ?? "", rl, reason, statusLabel].join(" ").toLowerCase(),
    };
  };

  return (
    <AppShell user={me} active="remote-approvals" title="재택근무 승인" subtitle={me.company.name}>
      <RemoteApprovalsClient pending={pendingReqs.map(toRow)} decided={decidedReqs.map(toRow)} from={fromISO} to={toISO} todayISO={todayISO} />
    </AppShell>
  );
}
