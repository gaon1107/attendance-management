// 관리자 대시보드 — 오늘 우리 회사 직원들의 출퇴근 현황을 한눈에 본다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { TopNav } from "@/app/components/TopNav";

function hhmm(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default async function DashboardPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const todays = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: startOfToday } },
    include: { user: true },
    orderBy: { clockIn: "asc" },
  });
  const employeeCount = await prisma.user.count({
    where: { companyId: me.companyId, role: "employee" },
  });

  const checkedInPeople = new Set(todays.map((r) => r.userId)).size;
  const workingNow = todays.filter((r) => !r.clockOut).length;

  const cards = [
    { label: "등록 직원", value: `${employeeCount}명`, color: "var(--text)" },
    { label: "오늘 출근", value: `${checkedInPeople}명`, color: "var(--primary)" },
    { label: "현재 근무 중", value: `${workingNow}명`, color: "var(--success)" },
  ];

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav user={me} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>대시보드</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 24 }}>
          {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })} · 오늘 근태 현황
        </p>

        {/* 요약 카드 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 28 }}>
          {cards.map((c) => (
            <div
              key={c.label}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 8 }}>{c.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* 오늘 출퇴근 목록 */}
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
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              padding: "12px 20px",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text-sub)",
              background: "#F9FAFB",
            }}
          >
            <div>이름</div>
            <div>출근</div>
            <div>퇴근</div>
            <div>상태</div>
          </div>
          {todays.length === 0 ? (
            <div style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
              아직 오늘 출근한 직원이 없습니다.
            </div>
          ) : (
            todays.map((rec) => (
              <div
                key={rec.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 14,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  {rec.user.name}
                  <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}>
                    {rec.user.role === "admin" ? " (관리자)" : ""}
                  </span>
                </div>
                <div>{hhmm(rec.clockIn)}</div>
                <div style={{ color: rec.clockOut ? "var(--text)" : "var(--text-sub)" }}>
                  {rec.clockOut ? hhmm(rec.clockOut) : "—"}
                </div>
                <div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: rec.clockOut ? "var(--text-sub)" : "var(--success)",
                      background: rec.clockOut ? "#F3F4F6" : "#DCFCE7",
                      padding: "3px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {rec.clockOut ? "퇴근" : "근무 중"}
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
