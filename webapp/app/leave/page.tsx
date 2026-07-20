// 휴가(직원 본인) — 잔여 연차 + 휴가 신청 + 내 신청 내역. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { LeaveRequestForm } from "./LeaveRequestForm";
import { cancelLeave } from "@/app/actions/leave";
import { leaveTypeLabel, leaveStatusLabel, usedLeaveDays, annualLeaveGranted } from "@/lib/leave";
import { getApprovalProgressMap, type ApprovalProgress, listApprovalCandidates, resolveCustomApprovers } from "@/lib/approval-server";
import { ApprovalLineEditor } from "@/app/components/ApprovalLineEditor";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
function rangeLabel(start: Date, end: Date): string {
  const s = ymd(start);
  const e = ymd(end);
  return s === e ? s : `${s} ~ ${e}`;
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  pending: { bg: "#FEF3C7", dot: "#B45309", color: "#B45309" },
  approved: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  rejected: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

export default async function LeavePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const requests = await prisma.leaveRequest.findMany({
    where: { userId: me.id, companyId: me.companyId },
    orderBy: { createdAt: "desc" },
  });

  // 부서장 결재선을 켠 회사면, 대기 중인 신청의 결재 진행상황을 함께 표시.
  const progressMap: Map<string, ApprovalProgress> =
    (me.company.approvalMode === "deptline" || me.company.approvalMode === "custom")
      ? await getApprovalProgressMap(me.companyId, "leave", requests.filter((r) => r.status === "pending").map((r) => r.id))
      : new Map();

  // 처리(승인/반려)된 신청의 처리자 이름 — 결정사유와 함께 "누가" 표시. (한 번에 조회)
  const deciderIds = [...new Set(requests.map((r) => r.decidedById).filter((v): v is string => !!v))];
  const deciderName = new Map<string, string>(
    deciderIds.length
      ? (await prisma.user.findMany({ where: { companyId: me.companyId, id: { in: deciderIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : []
  );

  const isCustom = me.company.approvalMode === "custom";
  const candidates = isCustom ? await listApprovalCandidates(me.companyId, me.id) : [];
  const currentLine = isCustom ? await resolveCustomApprovers(me.companyId, me.id, "leave") : [];

  const used = usedLeaveDays(requests);
  const granted = annualLeaveGranted(me); // 입사일 기준 자동 발생(관리자 수동조정 우선)
  const remaining = Math.round((granted - used) * 10) / 10;

  const kpis = [
    { label: "부여 연차", value: granted, color: "var(--text)" },
    { label: "사용", value: used, color: "var(--text)" },
    { label: "잔여", value: remaining, color: remaining > 0 ? "var(--primary)" : "var(--danger)" },
  ];

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle" };

  return (
    <AppShell user={me} active="leave" title="휴가" subtitle={`${me.name} 님`}>
      {isCustom && <ApprovalLineEditor requestType="leave" typeLabel="휴가" candidates={candidates} current={currentLine} />}
      {/* 잔여 연차 */}
      <div className="kpi-grid-3" style={{ marginBottom: 20 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color }}>
              {k.value}<span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>일</span>
            </div>
          </div>
        ))}
      </div>

      {/* PC=2단(신청 폼 | 내역), 좁은 화면=세로 */}
      <div className="split-2">
      {/* 신청 폼 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>휴가 신청</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 18, lineHeight: 1.6 }}>
          연차·반차는 잔여에서 차감되고, 병가는 차감되지 않습니다. 승인되면 그 날은 결근이 아니라 휴가로 처리됩니다.
        </p>
        <LeaveRequestForm />
      </div>

      {/* 내 신청 내역 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700 }}>내 신청 내역</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>종류</th>
                <th style={th}>기간</th>
                <th style={{ ...th, textAlign: "right" }}>일수</th>
                <th style={th}>상태</th>
                <th style={{ ...th, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    아직 신청한 휴가가 없습니다.
                  </td>
                </tr>
              ) : (
                requests.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontWeight: 700 }}>{leaveTypeLabel(r.type)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{rangeLabel(r.startDate, r.endDate)}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.days}일</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{leaveStatusLabel(r.status)}</span>
                        </span>
                        {(() => {
                          const p = progressMap.get(r.id);
                          if (!p) return null;
                          if (p.rejected) return <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4, fontWeight: 700 }}>부서장 반려 처리 중</div>;
                          return (
                            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4 }}>
                              결재 {p.approvedCount}/{p.total} 승인
                              {p.nextApproverName && <span> · 다음: <b>{p.nextApproverName}</b>{p.nextIsFinal && <span style={{ color: "var(--primary)", fontWeight: 700 }}> (전결)</span>}</span>}
                            </div>
                          );
                        })()}
                        {r.status !== "pending" && r.decisionComment && (
                          <div style={{ fontSize: 12, color: r.status === "rejected" ? "var(--danger)" : "var(--text-sub)", marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {r.status === "rejected" ? "반려 사유" : "승인 메모"}: {r.decisionComment}
                            {r.decidedById && deciderName.get(r.decidedById) && <span style={{ color: "var(--text-sub)" }}> · {deciderName.get(r.decidedById)}</span>}
                            {r.decidedAt && <span style={{ color: "var(--text-sub)" }}> · {ymd(r.decidedAt)}</span>}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {r.status === "pending" && (
                          <form action={cancelLeave}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" style={{ height: 30, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                              취소
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </AppShell>
  );
}
