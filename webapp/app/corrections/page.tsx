// 근태 정정(직원 본인) — 정정 요청 + 내 요청 내역. (휴가 화면과 같은 형식)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { CorrectionRequestForm } from "./CorrectionRequestForm";
import { cancelCorrection } from "@/app/actions/corrections";
import { correctionStatusLabel } from "@/lib/corrections";
import { getApprovalProgressMap, type ApprovalProgress } from "@/lib/approval-server";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  pending: { bg: "#FEF3C7", dot: "#B45309", color: "#B45309" },
  approved: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  rejected: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

export default async function CorrectionsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const requests = await prisma.attendanceCorrection.findMany({
    where: { userId: me.id, companyId: me.companyId },
    orderBy: { createdAt: "desc" },
  });

  const progressMap: Map<string, ApprovalProgress> =
    me.company.approvalMode === "deptline"
      ? await getApprovalProgressMap(me.companyId, "correction", requests.filter((r) => r.status === "pending").map((r) => r.id))
      : new Map();

  // 처리(승인/반려)된 요청의 처리자 이름 — 결정사유와 함께 "누가" 표시. (한 번에 조회)
  const deciderIds = [...new Set(requests.map((r) => r.decidedById).filter((v): v is string => !!v))];
  const deciderName = new Map<string, string>(
    deciderIds.length
      ? (await prisma.user.findMany({ where: { companyId: me.companyId, id: { in: deciderIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
      : []
  );

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle" };

  function timeReq(inHm: string | null, outHm: string | null): string {
    const parts: string[] = [];
    if (inHm) parts.push(`출근 ${inHm}`);
    if (outHm) parts.push(`퇴근 ${outHm}`);
    return parts.join(" · ") || "—";
  }

  return (
    <AppShell user={me} active="corrections" title="근태 정정" subtitle={`${me.name} 님`}>
      {/* PC=2단(요청 폼 | 내역), 좁은 화면=세로 */}
      <div className="split-2">
      {/* 요청 폼 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>근태 정정 요청</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 18, lineHeight: 1.6 }}>
          출근·퇴근을 깜빡했거나 시각이 잘못된 날을 정정 요청할 수 있습니다. 관리자가 승인하면 그 날 기록에 반영됩니다.
        </p>
        <CorrectionRequestForm />
      </div>

      {/* 내 요청 내역 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700 }}>내 요청 내역</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>대상 날짜</th>
                <th style={th}>요청 시각</th>
                <th style={th}>사유</th>
                <th style={th}>상태</th>
                <th style={{ ...th, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    아직 정정 요청이 없습니다.
                  </td>
                </tr>
              ) : (
                requests.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.pending;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{ymd(r.targetDate)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{timeReq(r.requestedIn, r.requestedOut)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{correctionStatusLabel(r.status)}</span>
                        </span>
                        {(() => {
                          const p = progressMap.get(r.id);
                          if (!p) return null;
                          if (p.rejected) return <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4, fontWeight: 700 }}>부서장 반려 처리 중</div>;
                          return (
                            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 4 }}>
                              결재 {p.approvedCount}/{p.total} 승인
                              {p.nextApproverName && <span> · 다음: <b>{p.nextApproverName}</b></span>}
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
                          <form action={cancelCorrection}>
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
