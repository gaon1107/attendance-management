// 근태 정정 승인(관리자 전용) — 대기 목록 승인/반려 + 처리 내역.
// 사이드바 아이콘은 없고, 대시보드 '오늘 알림'과 근태현황 화면에서 들어온다. (active는 근태현황으로 표시)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { approveCorrection, rejectCorrection } from "@/app/actions/corrections";
import { correctionStatusLabel } from "@/lib/corrections";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}
function timeReq(inHm: string | null, outHm: string | null): string {
  const parts: string[] = [];
  if (inHm) parts.push(`출근 ${inHm}`);
  if (outHm) parts.push(`퇴근 ${outHm}`);
  return parts.join(" · ") || "—";
}

const STATUS_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  approved: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  rejected: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

export default async function CorrectionApprovalsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const requests = await prisma.attendanceCorrection.findMany({
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

  const backBtn = (
    <Link href="/records" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 근태현황
    </Link>
  );

  return (
    <AppShell user={me} active="records" title="근태 정정 승인" subtitle={me.company.name} right={backBtn}>
      {/* 승인 대기 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 16, fontWeight: 700 }}>
          승인 대기 {pending.length > 0 && <span style={{ color: "var(--warning)" }}>{pending.length}건</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>대상 날짜</th>
                <th style={th}>요청 시각</th>
                <th style={th}>사유</th>
                <th style={{ ...th, textAlign: "right" }}>처리</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    승인 대기 중인 정정 요청이 없습니다.
                  </td>
                </tr>
              ) : (
                pending.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>{nameCell(r.user.name)}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymd(r.targetDate)}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{timeReq(r.requestedIn, r.requestedOut)}</td>
                    <td style={{ ...td, color: "var(--text-sub)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 8 }}>
                        <form action={approveCorrection}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" style={{ height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                            승인
                          </button>
                        </form>
                        <form action={rejectCorrection}>
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>대상 날짜</th>
                <th style={th}>요청 시각</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {decided.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "24px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    처리한 정정 요청이 없습니다.
                  </td>
                </tr>
              ) : (
                decided.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.approved;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={td}>{nameCell(r.user.name)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{ymd(r.targetDate)}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{timeReq(r.requestedIn, r.requestedOut)}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{correctionStatusLabel(r.status)}</span>
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
