// 근태 정정 승인(관리자 전용) — 대기 승인/반려 + 처리 내역. 기간 달력 + 통합검색(클라이언트).
// 사이드바 아이콘은 없고, 대시보드 '오늘 알림'과 근태현황 화면에서 들어온다. (active는 근태현황으로 표시)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { CorrectionApprovalsClient, type CorrectionRow } from "./CorrectionApprovalsClient";
import { correctionStatusLabel } from "@/lib/corrections";
import { parseAnchor, toISODate } from "@/lib/period";
import { getApprovalProgressMap } from "@/lib/approval-server";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}
function timeReq(inHm: string | null, outHm: string | null): string {
  const parts: string[] = [];
  if (inHm) parts.push(`출근 ${inHm}`);
  if (outHm) parts.push(`퇴근 ${outHm}`);
  return parts.join(" · ") || "—";
}

export default async function CorrectionApprovalsPage({
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
  // 과도한 전량 로드 방지: 최대 92일(초과 시 잘라 표시 종료일도 맞춤)
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + 92);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  // 대기: 항상 전체. 처리 내역: "처리한 시점(decidedAt)"이 선택 기간에 드는 것만(방금 처리분이 이번 달에 보이게).
  const pendingReqs = await prisma.attendanceCorrection.findMany({
    where: { companyId: me.companyId, status: "pending" },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const decidedReqs = await prisma.attendanceCorrection.findMany({
    where: { companyId: me.companyId, status: { not: "pending" }, decidedAt: { gte: start, lt: end } },
    include: { user: true },
    orderBy: { decidedAt: "desc" },
  });

  const progressMap =
    me.company.approvalMode === "deptline"
      ? await getApprovalProgressMap(me.companyId, "correction", pendingReqs.map((r) => r.id))
      : new Map();
  const progressLabel = (id: string): string | undefined => {
    const p = progressMap.get(id);
    if (!p) return undefined;
    if (p.rejected) return "부서장 반려됨";
    return `부서장 결재 ${p.approvedCount}/${p.total}${p.nextApproverName ? ` · 다음 ${p.nextApproverName}` : ""}`;
  };

  const toRow = (r: (typeof pendingReqs)[number]): CorrectionRow => {
    const dateText = ymd(r.targetDate);
    const timeText = timeReq(r.requestedIn, r.requestedOut);
    const statusLabel = correctionStatusLabel(r.status);
    return {
      id: r.id,
      name: r.user.name,
      employeeNo: r.user.employeeNo,
      initial: r.user.name.slice(0, 1),
      dateText,
      timeText,
      reason: r.reason,
      status: r.status,
      statusLabel,
      progress: progressLabel(r.id),
      search: [r.user.name, r.user.employeeNo ?? "", dateText, timeText, r.reason, statusLabel].join(" ").toLowerCase(),
    };
  };

  const backBtn = (
    <Link href="/records" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 근태현황
    </Link>
  );

  return (
    <AppShell user={me} active="records" title="근태 정정 승인" subtitle={me.company.name} right={backBtn}>
      <CorrectionApprovalsClient pending={pendingReqs.map(toRow)} decided={decidedReqs.map(toRow)} from={fromISO} to={toISO} todayISO={todayISO} />
    </AppShell>
  );
}
