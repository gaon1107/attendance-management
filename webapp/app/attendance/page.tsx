// 내 출퇴근 — 출근/퇴근 + 외출/복귀 + 실근무시간.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { TopNav } from "@/app/components/TopNav";
import { clockOut, startBreak, endBreak } from "@/app/actions/attendance";
import { workedMinutes, formatMinutes } from "@/lib/worktime";
import { workModeLabel, locationStatusLabel } from "@/lib/location";
import { ClockInPanel } from "./ClockInPanel";

function hhmm(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const REASONS = ["식사", "외근", "개인용무", "기타"];

export default async function AttendancePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  // 퇴근 안 한(=근무 중) 기록 + 외출 내역
  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
    include: { breaks: true },
  });
  const openBreak = open?.breaks.find((b) => !b.endAt) ?? null;

  // 오늘 기록
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todays = await prisma.attendance.findMany({
    where: { userId: me.id, clockIn: { gte: startOfToday } },
    orderBy: { clockIn: "asc" },
    include: { breaks: true },
  });

  const working = Boolean(open);
  const onBreak = Boolean(openBreak);

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav user={me} />
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "28px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>내 출퇴근</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 24 }}>
          {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
        </p>

        {!me.authMethod && (
          <a
            href="/auth-method"
            style={{ display: "block", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 14, color: "#1D4ED8", fontWeight: 700, textDecoration: "none" }}
          >
            출퇴근 인증방식(얼굴/GPS)을 선택해주세요 →
          </a>
        )}

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
              color: onBreak ? "var(--warning)" : working ? "var(--success)" : "var(--text)",
              marginBottom: 6,
            }}
          >
            {onBreak
              ? `외출 중 · ${openBreak!.reason} (${hhmm(openBreak!.startAt)}~)`
              : working
                ? `근무 중 (출근 ${hhmm(open!.clockIn)})`
                : "출근 전"}
          </div>
          {working && (
            <div style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 20 }}>
              {workModeLabel(open!.workMode)} · 현재까지 실근무 {formatMinutes(workedMinutes(open!))}
            </div>
          )}
          {!working && <div style={{ marginBottom: 20 }} />}

          {!working && <ClockInPanel />}

          {working && !onBreak && (
            <>
              <form action={clockOut} style={{ marginBottom: 12 }}>
                <button type="submit" style={bigBtn("var(--danger)")}>퇴근하기</button>
              </form>
              {/* 외출: 사유 선택 + 외출 시작 */}
              <form action={startBreak} style={{ display: "flex", gap: 8 }}>
                <select
                  name="reason"
                  defaultValue="식사"
                  style={{
                    flex: 1,
                    height: 48,
                    padding: "0 12px",
                    border: "1px solid #D1D5DB",
                    borderRadius: 10,
                    fontFamily: "inherit",
                    fontSize: 15,
                    background: "#fff",
                  }}
                >
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  style={{
                    width: 110,
                    height: 48,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    background: "#fff",
                    color: "var(--text)",
                    fontFamily: "inherit",
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  외출
                </button>
              </form>
            </>
          )}

          {onBreak && (
            <form action={endBreak}>
              <button type="submit" style={bigBtn("var(--warning)")}>복귀하기</button>
            </form>
          )}

          {working && (
            <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 14 }}>
              외출 시간은 실근무시간에서 제외됩니다.
            </div>
          )}
        </div>

        {/* 오늘 기록 */}
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>오늘 기록</div>
          {todays.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--text-sub)" }}>아직 오늘 출근 기록이 없습니다.</div>
          ) : (
            todays.map((rec) => {
              const done = Boolean(rec.clockOut);
              return (
                <div
                  key={rec.id}
                  style={{
                    padding: "14px 16px",
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    marginBottom: 8,
                    fontSize: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>출근 {hhmm(rec.clockIn)}</span>
                    <span style={{ color: done ? "var(--text)" : "var(--text-sub)" }}>
                      {done ? `퇴근 ${hhmm(rec.clockOut!)}` : "근무 중"}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", background: "#F3F4F6", padding: "2px 8px", borderRadius: 999 }}>
                      {workModeLabel(rec.workMode)}
                    </span>
                    {rec.workMode === "office" && (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          color: rec.locationStatus === "verified" ? "var(--success)" : "var(--warning)",
                          background: rec.locationStatus === "verified" ? "#DCFCE7" : "#FEF3C7",
                        }}
                      >
                        {locationStatusLabel(rec.locationStatus)}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-sub)", display: "flex", justifyContent: "space-between" }}>
                    <span>외출 {rec.breaks.length}회</span>
                    <span style={{ fontWeight: 700, color: "var(--primary)" }}>
                      실근무 {formatMinutes(workedMinutes(rec))}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}

function bigBtn(bg: string): React.CSSProperties {
  return {
    width: "100%",
    height: 56,
    border: "none",
    borderRadius: 12,
    background: bg,
    color: "#fff",
    fontFamily: "inherit",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
  };
}
