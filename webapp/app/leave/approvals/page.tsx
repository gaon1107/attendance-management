// 휴가 승인(관리자 전용) — 대기 목록 승인/반려 + 처리 내역. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { approveLeave, rejectLeave } from "@/app/actions/leave";
import { leaveTypeLabel, leaveStatusLabel } from "@/lib/leave";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
function rangeLabel(start: Date, end: Date): string {
  const s = ymd(start);
  const e = ymd(end);
  return s === e ? s : `${s} ~ ${e}`;
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  approved: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  rejected: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

export default async function LeaveApprovalsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const requests = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "13px 20px", fontSize: 15, verticalAlign: "middle" };

  function nameCell(name: string) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
          {name.slice(0, 1)}
        </div>
        <span style={{ fontWeight: 700 }}>{name}</span>
      </div>
    );
  }

  return (
    <AppShell user={me} active="leave-approvals" title="휴가 승인" subtitle={me.company.name}>
      {/* 승인 대기 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 16, fontWeight: 700 }}>
          승인 대기 {pending.length > 0 && <span style={{ color: "var(--warning)" }}>{pending.length}건</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>종류</th>
                <th style={th}>기간</th>
                <th style={{ ...th, textAlign: "right" }}>일수</th>
                <th style={th}>사유</th>
                <th style={{ ...th, textAlign: "right" }}>처리</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    승인 대기 중인 휴가 신청이 없습니다.
                  </td>
                </tr>
              ) : (
                pending.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>{nameCell(r.user.name)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{leaveTypeLabel(r.type)}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{rangeLabel(r.startDate, r.endDate)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.days}일</td>
                    <td style={{ ...td, color: "var(--text-sub)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 8 }}>
                        <form action={approveLeave}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" style={{ height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            승인
                          </button>
                        </form>
                        <form action={rejectLeave}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" style={{ height: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            반려
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 처리 내역 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 16, fontWeight: 700, color: "var(--text-sub)" }}>처리 내역</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>종류</th>
                <th style={th}>기간</th>
                <th style={{ ...th, textAlign: "right" }}>일수</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {decided.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "24px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    처리한 휴가가 없습니다.
                  </td>
                </tr>
              ) : (
                decided.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.approved;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={td}>{nameCell(r.user.name)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{leaveTypeLabel(r.type)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{rangeLabel(r.startDate, r.endDate)}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.days}일</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{leaveStatusLabel(r.status)}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
