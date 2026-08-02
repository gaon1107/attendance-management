// 휴가 승인(관리자 전용) — 대기 목록 승인/반려 + 처리 내역. 기간 달력 + 통합검색(클라이언트). (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { LeaveApprovalsClient, type LeaveRow } from "./LeaveApprovalsClient";
import { leaveTypeLabel, leaveStatusLabel, leaveTypeDeducts, leaveBalanceInYear } from "@/lib/leave";
import { parseAnchor, toISODate } from "@/lib/period";
import { getApprovalProgressMap, approvalProgressLabel, isSelfApprovalBlocked } from "@/lib/approval-server";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
// 취소 시각은 해를 넘긴 건도 있어 연도까지 적는다(검수 경미-1).
function ymdFull(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}
function rangeLabel(start: Date, end: Date): string {
  const s = ymd(start);
  const e = ymd(end);
  return s === e ? s : `${s} ~ ${e}`;
}

export default async function LeaveApprovalsPage({
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

  // 대기: 항상 전체. 처리 내역: "처리한 시점(decidedAt)"이 선택 기간에 드는 것만(방금 처리분이 이번 달에 보이게).
  const pendingReqs = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "pending" },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const decidedReqs = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: { not: "pending" }, decidedAt: { gte: start, lt: end } },
    include: { user: true },
    orderBy: { decidedAt: "desc" },
  });

  // 부서장 결재선을 켠 회사면, 대기 건의 결재 진행상황을 함께 보여 관리자가 조기 승인하지 않도록 안내.
  const progressMap =
    (me.company.approvalMode === "deptline" || me.company.approvalMode === "custom")
      ? await getApprovalProgressMap(me.companyId, "leave", pendingReqs.map((r) => r.id))
      : new Map();
  const progressLabel = (id: string): string | undefined => {
    // 문구는 lib/approval-server.ts 한 곳에서 만든다(6개 승인화면이 같은 말을 하도록).
    return approvalProgressLabel(progressMap.get(id));
  };

  // 대기 건 중 "승인하면 잔여 연차를 넘는" 것을 미리 표시한다(검수 C-2).
  //  · 서버(approveLeave)가 실제로 승인을 막으므로, 관리자가 이유를 모른 채 계속 누르지 않도록 화면에 알려준다.
  //  · 신청 단계에서 이미 대기분까지 빼고 검사하므로 평소엔 뜨지 않는다. 관리자가 나중에 연차 부여량을
  //    줄였을 때처럼 예외 상황에서만 나타난다.
  const shortageById = new Map<string, string>();
  {
    const applicantIds = [...new Set(pendingReqs.filter((r) => leaveTypeDeducts(r.type)).map((r) => r.userId))];
    if (applicantIds.length) {
      const theirLeaves = await prisma.leaveRequest.findMany({
        where: { companyId: me.companyId, userId: { in: applicantIds } },
        select: { userId: true, type: true, days: true, status: true, startDate: true },
      });
      const byUser = new Map<string, typeof theirLeaves>();
      for (const lv of theirLeaves) {
        const arr = byUser.get(lv.userId);
        if (arr) arr.push(lv);
        else byUser.set(lv.userId, [lv]);
      }
      for (const r of pendingReqs) {
        if (!leaveTypeDeducts(r.type)) continue;
        const year = r.startDate.getFullYear();
        const bal = leaveBalanceInYear(r.user, byUser.get(r.userId) ?? [], year);
        // approveLeave와 **같은 공식**을 쓴다: 발생 − 확정 사용분(승인). 대기건은 빼지 않는다.
        const availableForThis = Math.round((bal.granted - bal.used) * 10) / 10;
        if (r.days > availableForThis) {
          shortageById.set(
            r.id,
            `잔여 부족 — 승인 가능한 연차 ${availableForThis}일 / 신청 ${r.days}일 (발생 ${bal.granted}일 − 사용 ${bal.used}일). 승인되지 않습니다.`
          );
        }
      }
    }
  }

  // 승인 취소(M-2) 표시용 준비.
  //  · 자기 휴가는 자기가 되돌릴 수 없다(서버 액션과 같은 규칙). 회사에 다른 관리자가 있을 때만 막으므로
  //    한 번만 계산해 두고, 내 신청 줄에서만 버튼을 감춘다(눌러도 안 되는 버튼을 보여주지 않기 위함).
  const selfCancelBlocked = await isSelfApprovalBlocked(me, me.id);
  // 취소한 관리자 이름(처리 내역에 "누가 취소했는지" 표시) — 한 번에 조회.
  const cancellerIds = [...new Set(decidedReqs.map((r) => r.cancelledById).filter((v): v is string => !!v))];
  const cancellerName = new Map<string, string>(
    cancellerIds.length
      ? (await prisma.user.findMany({ where: { companyId: me.companyId, id: { in: cancellerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : []
  );
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const thisYear = startOfToday.getFullYear();

  const toRow = (r: (typeof pendingReqs)[number]): LeaveRow => {
    const typeLabel = leaveTypeLabel(r.type);
    const rl = rangeLabel(r.startDate, r.endDate);
    const statusLabel = leaveStatusLabel(r.status);
    const reason = r.reason || "";
    const canceller = r.cancelledById ? cancellerName.get(r.cancelledById) : undefined;
    return {
      id: r.id,
      name: r.user.name,
      employeeNo: r.user.employeeNo,
      initial: r.user.name.slice(0, 1),
      typeLabel,
      rangeLabel: rl,
      days: r.days,
      reason,
      status: r.status,
      statusLabel,
      progress: progressLabel(r.id),
      shortage: shortageById.get(r.id),
      // 승인된 건만 되돌릴 수 있고, 내 휴가는 다른 관리자가 있으면 내가 못 되돌린다.
      canCancel: r.status === "approved" && !(selfCancelBlocked && r.userId === me.id),
      selfBlocked: r.status === "approved" && selfCancelBlocked && r.userId === me.id,
      hasPastDate: r.startDate < startOfToday, // 지난 날짜가 섞이면 "결근으로 바뀜" 경고를 띄운다
      deducts: leaveTypeDeducts(r.type), // 연차를 깎는 종류인가 — 취소 안내 문구가 달라진다(검수 C-2)
      // 잔여 연차는 "휴가 시작일의 연도"로 귀속된다 → 작년 휴가를 취소해도 올해 잔여는 안 는다(검수 C-1)
      otherYear: r.startDate.getFullYear() !== thisYear ? r.startDate.getFullYear() : undefined,
      cancelNote:
        r.status === "cancelled"
          ? `취소 사유: ${r.cancelReason ?? "—"}${canceller ? ` · ${canceller}` : ""}${r.cancelledAt ? ` · ${ymdFull(r.cancelledAt)}` : ""}`
          : undefined,
      search: [r.user.name, r.user.employeeNo ?? "", typeLabel, rl, reason, statusLabel, r.cancelReason ?? ""].join(" ").toLowerCase(),
    };
  };

  return (
    <AppShell user={me} active="leave-approvals" title="휴가 승인" subtitle={me.company.name}>
      <LeaveApprovalsClient pending={pendingReqs.map(toRow)} decided={decidedReqs.map(toRow)} from={fromISO} to={toISO} todayISO={todayISO} />
    </AppShell>
  );
}
