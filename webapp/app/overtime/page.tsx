// 초과근무(직원 본인) — 사전신청 폼 + 내 신청 내역. (외출외근 화면과 같은 형식)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { OvertimeRequestForm } from "./OvertimeRequestForm";
import { cancelOvertime } from "@/app/actions/overtime";
import { overtimeStatusLabel, overtimeTimeLabel } from "@/lib/overtime-request";
import { getApprovalProgressMap, type ApprovalProgress } from "@/lib/approval-server";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  pending: { bg: "#FEF3C7", dot: "#B45309", color: "#B45309" },
  approved: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  rejected: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

export default async function OvertimePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const requests = await prisma.overtimeRequest.findMany({
    where: { userId: me.id, companyId: me.companyId },
    orderBy: { createdAt: "desc" },
  });

  const progressMap: Map<string, ApprovalProgress> =
    me.company.approvalMode === "deptline"
      ? await getApprovalProgressMap(me.companyId, "overtime", requests.filter((r) => r.status === "pending").map((r) => r.id))
      : new Map();

  const deciderIds = [...new Set(requests.map((r) => r.decidedById).filter((v): v is string => !!v))];
  const deciderName = new Map<string, string>(
    deciderIds.length
      ? (await prisma.user.findMany({ where: { companyId: me.companyId, id: { in: deciderIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : []
  );

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle" };

  return (
    <AppShell user={me} active="overtime" title="초과근무 신청" subtitle={`${me.name} 님`}>
      <div className="split-2">
      {/* 신청 폼 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>초과근무(야근) 사전신청</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 18, lineHeight: 1.6 }}>
          야근을 미리 신청해 승인받는 기능입니다. 승인은 <b>사전 허가 기록</b>으로 남으며, 실제 초과근무·주 52시간 계산은 기존 방식(실근무 자동 집계) 그대로입니다.
        </p>
        <OvertimeRequestForm />
      </div>

      {/* 내 신청 내역 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700 }}>내 신청 내역</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>날짜</th>
                <th style={th}>시간</th>
                <th style={th}>사유</th>
                <th style={th}>상태</th>
                <th style={{ ...th, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    아직 신청한 초과근무가 없습니다.
                  </td>
                </tr>
              ) : (
                requests.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{ymd(r.targetDate)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{overtimeTimeLabel(r.startTime, r.endTime)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason || "—"}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{overtimeStatusLabel(r.status)}</span>
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
                          <form action={cancelOvertime}>
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
