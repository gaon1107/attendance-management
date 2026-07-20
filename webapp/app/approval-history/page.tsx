// 결재 이력(관리자 전용) — 회사 전체 신청(6종)의 신청·승인·반려 이력을 한 표로 조회한다. 읽기 전용.
//  · 필터: 유형·상태·직원·기간(신청일). 필터 UI는 공통 컴포넌트(RangeCalendar 등)로 서버 조회(회사격리는 lib/approval-history).
//  · 내부통제 감시용: custom 결재선의 상호승인 등도 사후에 관리자가 발견할 수 있게 한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { listApprovalHistory, HISTORY_LIMIT, type HistoryFilter, type HistoryStatus } from "@/lib/approval-history";
import type { RequestType } from "@/lib/approval-server";
import { toISODate } from "@/lib/period";
import { ApprovalHistoryFilters, type EmpOption } from "./ApprovalHistoryFilters";

const TYPES: RequestType[] = ["leave", "correction", "outing", "remote", "overtime", "trip"];
const TYPE_LABEL: Record<RequestType, string> = { leave: "휴가", correction: "근태정정", outing: "외출/외근", remote: "재택근무", overtime: "초과근무", trip: "출장" };
const TYPE_BADGE: Record<RequestType, { bg: string; color: string }> = {
  leave: { bg: "#E4EDFF", color: "#2563EB" },
  correction: { bg: "#FEF3C7", color: "#B45309" },
  outing: { bg: "#DCFCE7", color: "#15803D" },
  remote: { bg: "#EDE9FE", color: "#7C3AED" },
  overtime: { bg: "#FFE4E6", color: "#BE123C" },
  trip: { bg: "#E0F2FE", color: "#0369A1" },
};
const STATUS_LABEL: Record<string, string> = { pending: "대기", approved: "승인", rejected: "반려" };
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  pending: { bg: "#FEF3C7", color: "#B45309" },
  approved: { bg: "#DCFCE7", color: "#15803D" },
  rejected: { bg: "#FEE2E2", color: "#B91C1C" },
};

function ymdhm(d: Date): string {
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function ApprovalHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; userId?: string; from?: string; to?: string; all?: string }>;
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
  //  · all=1이면 전체 기간(감사용): 조회는 from/to=null로 기간필터를 걸지 않고, 달력엔 기본 이번 달을 표시(재선택 기준점).
  const allPeriod = sp.all === "1";
  const now = new Date();
  const todayISO = toISODate(now);
  const defFrom = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const fromISO = normISO(sp.from) || defFrom;
  let toISO = normISO(sp.to) || defTo;
  if (toISO < fromISO) toISO = fromISO; // 종료<시작이면 보정

  // 직원 드롭다운 — 감사 대상엔 퇴사자도 포함(퇴사자 이력 필터·URL 재접속 시 조용히 '전체'로 풀리는 것 방지).
  //  퇴사자는 "(퇴사)"로 표기. userId 필터 검증도 이 전체 목록 기준.
  const emps = await prisma.user.findMany({
    where: { companyId: me.companyId },
    select: { id: true, name: true, employeeNo: true, deactivatedAt: true },
    orderBy: { name: "asc" },
  });
  const userF = sp.userId && emps.some((e) => e.id === sp.userId) ? sp.userId : "all";

  const filter: HistoryFilter = {
    type: typeF,
    status: statusF,
    userId: userF,
    // 전체 기간이면 기간필터 제거(null) → 과거 포함 전체 조회(상한 300건 유지).
    from: allPeriod ? null : fromISO ? new Date(fromISO + "T00:00:00") : null,
    to: allPeriod ? null : toISO ? new Date(toISO + "T23:59:59.999") : null,
  };
  const rows = await listApprovalHistory(me.companyId, filter);
  const empOpts: EmpOption[] = emps.map((e) => ({ id: e.id, name: e.name, employeeNo: e.employeeNo, retired: !!e.deactivatedAt }));

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 14px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 14px", fontSize: 14, verticalAlign: "top" };
  const badge = (bg: string, color: string, text: string): React.ReactElement => (
    <span style={{ display: "inline-block", fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: bg, color, whiteSpace: "nowrap" }}>{text}</span>
  );

  return (
    <AppShell user={me} active="approval-history" title="결재 이력" subtitle={`${me.company.name} · 전체 신청·승인·반려 조회`}>
      {/* 필터 바 — 공통 기간 달력(RangeCalendar) 사용(브라우저 기본 달력 금지, 디자인 규칙 §5.6) */}
      <ApprovalHistoryFilters type={typeF} status={statusF} userId={userF} from={fromISO} to={toISO} todayISO={todayISO} allPeriod={allPeriod} emps={empOpts} />

      {/* 결과 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>조회 결과 {rows.length}건{rows.length >= HISTORY_LIMIT ? ` · 표시 상한 ${HISTORY_LIMIT}건 도달(더 있을 수 있으니 필터로 좁혀보세요)` : ""}</span>
          {/* 지금 무슨 기간을 보고 있는지 항상 표기 — 기본 '이번 달'이 과거 이력을 조용히 가리지 않도록. */}
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
            조회 기간(신청일 기준): {allPeriod ? "전체 기간" : `${fromISO} ~ ${toISO}`}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청일시</th>
                <th style={th}>유형</th>
                <th style={th}>신청자</th>
                <th style={th}>내용</th>
                <th style={th}>상태</th>
                <th style={th}>처리자</th>
                <th style={th}>처리일시</th>
                <th style={th}>결재 의견</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "32px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>조회된 결재 이력이 없습니다.</td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.type}-${r.requestId}`} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, color: "var(--text-sub)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{ymdhm(r.createdAt)}</td>
                    <td style={td}>{badge(TYPE_BADGE[r.type].bg, TYPE_BADGE[r.type].color, TYPE_LABEL[r.type])}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 700 }}>{r.applicantName}</span>
                      {r.applicantNo && <span style={{ fontSize: 12, color: "var(--text-sub)", marginLeft: 6 }}>{r.applicantNo}</span>}
                      {r.applicantDept && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.applicantDept}</div>}
                    </td>
                    <td style={{ ...td, minWidth: 200 }}>
                      <div>{r.summary}</div>
                      {r.reason && <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>사유: {r.reason}</div>}
                    </td>
                    <td style={td}>{badge(STATUS_STYLE[r.status]?.bg ?? "#EEE", STATUS_STYLE[r.status]?.color ?? "#555", STATUS_LABEL[r.status] ?? r.status)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: r.decidedByName ? "var(--text)" : "var(--text-sub)" }}>{r.decidedByName ?? "—"}</td>
                    <td style={{ ...td, color: "var(--text-sub)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.decidedAt ? ymdhm(r.decidedAt) : "—"}</td>
                    <td style={{ ...td, minWidth: 160, color: r.status === "rejected" ? "var(--danger)" : "var(--text-sub)" }}>
                      {r.decisionComment ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.decisionComment}</span> : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
