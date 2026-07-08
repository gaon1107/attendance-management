// 직원 관리 (관리자 전용) — 직원 목록 + 직원 추가. (리뉴얼 디자인)
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { AddEmployeeForm } from "./AddEmployeeForm";
import { InviteLink } from "./InviteLink";
import { PendingResetRequests } from "./PendingResetRequests";
import { DepartmentManager } from "./DepartmentManager";
import { createInvite, cancelInvite } from "@/app/actions/invites";

function ymd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default async function EmployeesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const allEmployees = await prisma.user.findMany({
    where: { companyId: me.companyId, role: "employee" },
    orderBy: { createdAt: "asc" },
    include: { department: { select: { name: true } } },
  });
  // 재직중(퇴사 안 한) / 퇴사(비활성화) 분리
  const employees = allEmployees.filter((e) => !e.deactivatedAt);
  const retired = allEmployees.filter((e) => e.deactivatedAt);

  // 부서 목록 + 부서별 재직 인원 수(부서 관리 섹션용)
  const departments = await prisma.department.findMany({
    where: { companyId: me.companyId },
    orderBy: { name: "asc" },
  });
  const deptData = departments.map((d) => ({
    id: d.id,
    name: d.name,
    memberCount: employees.filter((e) => e.departmentId === d.id).length,
  }));

  // 아직 안 쓴(미만료) 초대 링크
  const invites = await prisma.invite.findMany({
    where: { companyId: me.companyId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  // 비밀번호 재설정 대기 요청(직원이 접수한 것) — 관리자가 임시 비밀번호를 발급한다.
  const resetRequests = await prisma.passwordResetRequest.findMany({
    where: { companyId: me.companyId, status: "pending" },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const resetReqData = resetRequests.map((r) => ({
    id: r.id,
    name: r.user.name,
    email: r.user.email,
    createdAtLabel: r.createdAt.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  }));

  // 실제 데이터로만 집계 (재직중 기준)
  const faceCount = employees.filter((e) => e.authMethod === "face").length;
  const gpsCount = employees.filter((e) => e.authMethod === "gps").length;
  const unsetCount = employees.filter((e) => e.authMethod !== "face" && e.authMethod !== "gps").length;

  const kpis = [
    { label: "재직 직원", value: `${employees.length}`, unit: "명", color: "var(--text)" },
    { label: "얼굴인증 사용", value: `${faceCount}`, unit: "명", color: "var(--text)" },
    { label: "GPS 사용", value: `${gpsCount}`, unit: "명", color: "var(--text)" },
    { label: "인증 미설정", value: `${unsetCount}`, unit: "명", color: unsetCount > 0 ? "var(--warning)" : "var(--text)" },
  ];

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px" };
  const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle" };

  return (
    <AppShell user={me} active="employees" title="직원 관리" subtitle={`${me.company.name} · 재직 ${employees.length}명`}>
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

      {/* 비밀번호 재설정 대기 요청 (있을 때만 표시) */}
      <PendingResetRequests requests={resetReqData} />

      {/* 부서 관리 */}
      <DepartmentManager departments={deptData} />

      {/* 직원 초대 (링크 방식 — 직원이 스스로 가입) */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>직원 초대</div>
        <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
          초대 링크를 만들어 직원에게 보내면(카톡·문자 등), 직원이 링크로 <b>직접 가입</b>합니다. 비밀번호는 직원 본인이 정합니다. (링크는 7일간, 1회만 사용 가능)
        </p>
        <form action={createInvite}>
          <button
            type="submit"
            style={{ height: 44, padding: "0 18px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
          >
            + 초대 링크 만들기
          </button>
        </form>

        {invites.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {invites.map((inv) => (
              <div key={inv.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 700, whiteSpace: "nowrap" }}>
                    만료 {inv.expiresAt.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}까지
                  </span>
                  <form action={cancelInvite}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button type="submit" style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                      취소
                    </button>
                  </form>
                </div>
                <InviteLink path={`/invite/${inv.token}`} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 직원 직접 등록 (관리자가 계정을 바로 만들 때) */}
      <AddEmployeeForm />

      {/* 직원 목록 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>부서</th>
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
                  <td colSpan={7} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
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
                        <Link href={`/employees/${emp.id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text)" }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                            {emp.name.slice(0, 1)}
                          </div>
                          <span style={{ fontWeight: 700 }}>{emp.name}</span>
                        </Link>
                      </td>
                      <td style={{ ...td, color: emp.department ? "var(--text)" : "#9CA3AF" }}>{emp.department?.name ?? "미배정"}</td>
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

      {/* 퇴사한 직원 (비활성화) — 과거 근태 기록은 리포트에 그대로 남는다. 복직은 이름 클릭 후 상세에서. */}
      {retired.length > 0 && (
        <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginTop: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700, color: "var(--text-sub)" }}>
            퇴사한 직원 {retired.length}명 <span style={{ fontWeight: 400 }}>(과거 근태 기록은 리포트에 보존됩니다)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th}>이름</th>
                  <th style={th}>이메일</th>
                  <th style={th}>퇴사일</th>
                  <th style={th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {retired.map((emp) => (
                  <tr key={emp.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      <Link href={`/employees/${emp.id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text-sub)" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#9CA3AF", flexShrink: 0 }}>
                          {emp.name.slice(0, 1)}
                        </div>
                        <span style={{ fontWeight: 700 }}>{emp.name}</span>
                      </Link>
                    </td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{emp.email}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{emp.deactivatedAt ? ymd(emp.deactivatedAt) : "—"}</td>
                    <td style={td}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#F3F4F6" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9CA3AF" }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#6B7280" }}>퇴사</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}
