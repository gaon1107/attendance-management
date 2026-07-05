// 직원 관리 (관리자 전용) — 직원 목록 + 직원 추가.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { TopNav } from "@/app/components/TopNav";
import { AddEmployeeForm } from "./AddEmployeeForm";

export default async function EmployeesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const employees = await prisma.user.findMany({
    where: { companyId: me.companyId, role: "employee" },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav user={me} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>직원 관리</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 24 }}>
          직원을 등록하면, 그 직원이 로그인해 출퇴근을 기록할 수 있습니다.
        </p>

        <AddEmployeeForm />

        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr 1fr",
              padding: "12px 20px",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text-sub)",
              background: "#F9FAFB",
            }}
          >
            <div>이름</div>
            <div>이메일</div>
            <div>상태</div>
          </div>
          {employees.length === 0 ? (
            <div style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
              아직 등록된 직원이 없습니다. 위에서 첫 직원을 추가해보세요.
            </div>
          ) : (
            employees.map((emp) => (
              <div
                key={emp.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr 1fr",
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 14,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 700 }}>{emp.name}</div>
                <div style={{ color: "var(--text-sub)" }}>{emp.email}</div>
                <div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--success)",
                      background: "#DCFCE7",
                      padding: "3px 10px",
                      borderRadius: 999,
                    }}
                  >
                    재직중
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
