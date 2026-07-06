// 직원 관리 (관리자 전용) — 직원 목록 + 직원 추가. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { AddEmployeeForm } from "./AddEmployeeForm";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function EmployeesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const employees = await prisma.user.findMany({
    where: { companyId: me.companyId, role: "employee" },
    orderBy: { createdAt: "asc" },
  });

  // 실제 데이터로만 집계
  const faceCount = employees.filter((e) => e.authMethod === "face").length;
  const gpsCount = employees.filter((e) => e.authMethod === "gps").length;
  const unsetCount = employees.filter((e) => e.authMethod !== "face" && e.authMethod !== "gps").length;

  const kpis = [
    { label: "전체 직원", value: `${employees.length}`, unit: "명", color: "var(--text)" },
    { label: "얼굴인증 사용", value: `${faceCount}`, unit: "명", color: "var(--text)" },
    { label: "GPS 사용", value: `${gpsCount}`, unit: "명", color: "var(--text)" },
    { label: "인증 미설정", value: `${unsetCount}`, unit: "명", color: unsetCount > 0 ? "var(--warning)" : "var(--text)" },
  ];

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px" };
  const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle" };

  return (
    <AppShell user={me} active="employees" title="직원 관리" subtitle={`${me.company.name} · 총 ${employees.length}명`}>
      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 직원 추가 폼 (기존 기능 유지) */}
      <AddEmployeeForm />

      {/* 직원 목록 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>이메일</th>
                <th style={th}>인증방식</th>
                <th style={th}>생체동의</th>
                <th style={th}>가입일</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    아직 등록된 직원이 없습니다. 위에서 첫 직원을 추가해보세요.
                  </td>
                </tr>
              ) : (
                employees.map((emp) => {
                  const auth = emp.authMethod === "face" ? "얼굴인증" : emp.authMethod === "gps" ? "GPS" : "미설정";
                  const authColor = emp.authMethod ? "var(--text)" : "#9CA3AF";
                  const consented = !!emp.faceConsentAt;
                  return (
                    <tr key={emp.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                            {emp.name.slice(0, 1)}
                          </div>
                          <span style={{ fontWeight: 700 }}>{emp.name}</span>
                        </div>
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{emp.email}</td>
                      <td style={{ ...td, color: authColor }}>{auth}</td>
                      <td style={{ ...td, color: consented ? "#15803D" : "#9CA3AF" }}>{consented ? "동의함" : "—"}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{ymd(emp.createdAt)}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#F3F4F6" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>재직중</span>
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
