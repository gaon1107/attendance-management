// 내 출퇴근 — 로그인한 본인의 오늘 출근/퇴근. 출근하면 근무 중, 퇴근하면 완료.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { TopNav } from "@/app/components/TopNav";
import { clockIn, clockOut } from "@/app/actions/attendance";

// 시각을 09:02 형태로 표시
function hhmm(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default async function AttendancePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  // 퇴근 안 한(=근무 중) 기록
  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });

  // 오늘 기록들
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todays = await prisma.attendance.findMany({
    where: { userId: me.id, clockIn: { gte: startOfToday } },
    orderBy: { clockIn: "asc" },
  });

  const working = Boolean(open);

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav user={me} />
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>내 출퇴근</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 24 }}>
          {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
        </p>

        {/* 현재 상태 카드 */}
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 28,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 6 }}>현재 상태</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: working ? "var(--success)" : "var(--text)",
              marginBottom: 20,
            }}
          >
            {working ? `근무 중 (출근 ${hhmm(open!.clockIn)})` : "출근 전"}
          </div>

          {working ? (
            <form action={clockOut}>
              <button
                type="submit"
                style={{
                  width: "100%",
                  height: 56,
                  border: "none",
                  borderRadius: 12,
                  background: "var(--danger)",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 18,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                퇴근하기
              </button>
            </form>
          ) : (
            <form action={clockIn}>
              <button
                type="submit"
                style={{
                  width: "100%",
                  height: 56,
                  border: "none",
                  borderRadius: 12,
                  background: "var(--primary)",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 18,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                출근하기
              </button>
            </form>
          )}
        </div>

        {/* 오늘 기록 */}
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>오늘 기록</div>
          {todays.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--text-sub)" }}>아직 오늘 출근 기록이 없습니다.</div>
          ) : (
            todays.map((rec) => (
              <div
                key={rec.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  marginBottom: 8,
                  fontSize: 14,
                }}
              >
                <span>출근 {hhmm(rec.clockIn)}</span>
                <span style={{ color: rec.clockOut ? "var(--text)" : "var(--text-sub)" }}>
                  {rec.clockOut ? `퇴근 ${hhmm(rec.clockOut)}` : "근무 중"}
                </span>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
