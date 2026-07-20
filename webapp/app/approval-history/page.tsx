// 결재 이력(관리자 전용) — 회사 전체 신청(6종)의 신청·승인·반려 이력을 한 표로 조회한다. 읽기 전용.
//  · 필터: 유형·상태·기간(신청일)은 서버 조회, 직원은 통합검색(SearchBox, 클라 즉시필터)으로 대체.
//  · 내부통제 감시용: custom 결재선의 상호승인 등도 사후에 관리자가 발견할 수 있게 한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/app/components/AppShell";
import { listApprovalHistory, HISTORY_LIMIT, type HistoryFilter, type HistoryStatus } from "@/lib/approval-history";
import type { RequestType } from "@/lib/approval-server";
import { toISODate } from "@/lib/period";
import { ApprovalHistoryClient, type HistoryClientRow } from "./ApprovalHistoryClient";

const TYPES: RequestType[] = ["leave", "correction", "outing", "remote", "overtime", "trip"];
const TYPE_LABEL: Record<RequestType, string> = { leave: "휴가", correction: "근태정정", outing: "외출/외근", remote: "재택근무", overtime: "초과근무", trip: "출장" };
const STATUS_LABEL: Record<string, string> = { pending: "대기", approved: "승인", rejected: "반려" };

function ymdhm(d: Date): string {
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function ApprovalHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const typeF: RequestType | "all" = TYPES.includes(sp.type as RequestType) ? (sp.type as RequestType) : "all";
  const statusF: HistoryStatus | "all" = ["pending", "approved", "rejected"].includes(sp.status ?? "") ? (sp.status as HistoryStatus) : "all";
  const normISO = (s?: string): string => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    const d = new Date(s + "T00:00:00");
    if (Number.isNaN(d.getTime())) return "";
    // 실재하지 않는 날짜(02-30 등)는 JS Date가 다른 날로 굴러가므로, 되돌려 원본과 같을 때만 통과.
    const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return back === s ? s : "";
  };
  // 공통 기간 달력(RangeCalendar)은 값이 항상 "시작~종료"라, 미지정이면 기본=이번 달(외출승인 등과 동일).
  //  · 과거 이력이 조용히 숨지 않도록, 지금 조회 중인 기간을 결과 헤더에 항상 표기한다(과거를 보려면 달력에서 기간을 넓게 잡는다).
  const now = new Date();
  const todayISO = toISODate(now);
  const defFrom = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const fromISO = normISO(sp.from) || defFrom;
  let toISO = normISO(sp.to) || defTo;
  if (toISO < fromISO) toISO = fromISO; // 종료<시작이면 보정

  // 직원 필터는 통합검색(클라)으로 대체 — userId 서버필터·전 직원 드롭다운 조회 제거(수백 명 회사 대응).
  const filter: HistoryFilter = {
    type: typeF,
    status: statusF,
    from: fromISO ? new Date(fromISO + "T00:00:00") : null,
    to: toISO ? new Date(toISO + "T23:59:59.999") : null,
  };
  const rows = await listApprovalHistory(me.companyId, filter);

  // 각 행에 통합검색용 문자열(소문자 결합)을 심어 클라이언트로 넘긴다. 날짜는 서버에서 문자열로 포맷(직렬화 안전).
  const clientRows: HistoryClientRow[] = rows.map((r) => ({
    key: `${r.type}-${r.requestId}`,
    type: r.type,
    createdAtText: ymdhm(r.createdAt),
    applicantName: r.applicantName,
    applicantNo: r.applicantNo,
    applicantDept: r.applicantDept,
    summary: r.summary,
    reason: r.reason,
    status: r.status,
    decidedByName: r.decidedByName,
    decidedAtText: r.decidedAt ? ymdhm(r.decidedAt) : null,
    decisionComment: r.decisionComment,
    search: [r.applicantName, r.applicantNo, r.applicantDept, TYPE_LABEL[r.type], r.summary, r.reason, STATUS_LABEL[r.status] ?? r.status, r.decidedByName, r.decisionComment]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  }));

  return (
    <AppShell user={me} active="approval-history" title="결재 이력" subtitle={`${me.company.name} · 전체 신청·승인·반려 조회`}>
      <ApprovalHistoryClient
        rows={clientRows}
        type={typeF}
        status={statusF}
        from={fromISO}
        to={toISO}
        todayISO={todayISO}
        limitReached={rows.length >= HISTORY_LIMIT}
        historyLimit={HISTORY_LIMIT}
      />
    </AppShell>
  );
}
