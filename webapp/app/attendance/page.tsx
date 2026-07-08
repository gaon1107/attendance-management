// 내 출퇴근 — 출근/퇴근 + 외출/복귀 + 실근무시간. (리뉴얼 디자인 · PC/모바일 반응형)
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
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
  if (me.mustChangePassword) redirect("/change-password");

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

  // 최신 사내 공지(있으면 배너로 안내)
  const latestNotice = await prisma.announcement.findFirst({
    where: { companyId: me.companyId },
    orderBy: { createdAt: "desc" },
    select: { title: true },
  });
  // 안 읽은 공지(알림) 수 = 마지막 확인 시각 이후 올라온 공지. (확인 시각 없으면 전부)
  const unreadNotices = await prisma.announcement.count({
    where: { companyId: me.companyId, ...(me.noticesSeenAt ? { createdAt: { gt: me.noticesSeenAt } } : {}) },
  });

  const working = Boolean(open);
  const onBreak = Boolean(openBreak);

  // 출근/퇴근 요약(가장 최근 기록 기준) — 실제 데이터만
  const latest = open ?? (todays.length > 0 ? todays[todays.length - 1] : null);
  const inLabel = latest ? hhmm(latest.clockIn) : "—";
  const outLabel = latest?.clockOut ? hhmm(latest.clockOut) : "—";

  const todayLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const datePill = <span style={{ fontSize: 13, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{todayLabel}</span>;

  return (
    <AppShell user={me} active="attendance" title="내 출퇴근" subtitle={`${me.name} 님`} right={datePill} narrow>
      {!me.authMethod && (
        <a
          href="/auth-method"
          style={{ display: "block", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 14, color: "#1D4ED8", fontWeight: 700, textDecoration: "none" }}
        >
          출퇴근 인증방식(얼굴/GPS)을 선택해주세요 →
        </a>
      )}

      {latestNotice && (
        <a
          href="/notice"
          style={{ display: "flex", alignItems: "center", gap: 8, background: unreadNotices > 0 ? "#FEF2F2" : "var(--bg)", border: `1px solid ${unreadNotices > 0 ? "#FECACA" : "var(--border)"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 14, color: "var(--text)", fontWeight: 700, textDecoration: "none" }}
        >
          <span style={{ flexShrink: 0 }}>{unreadNotices > 0 ? "🔔" : "📢"}</span>
          {unreadNotices > 0 && (
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#fff", background: "var(--danger)", borderRadius: 999, padding: "2px 7px" }}>
              새 알림 {unreadNotices}
            </span>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{latestNotice.title}</span>
        </a>
      )}

      {/* 현재 상태 카드 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 24 }}>
        {/* 출근 → 퇴근 요약 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--border)", borderRadius: 11, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 4 }}>출근</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{inLabel}</div>
          </div>
          <span style={{ color: "#C7CDD4", padding: "0 8px" }}>→</span>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 4 }}>퇴근</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: latest?.clockOut ? "var(--text)" : "#9CA3AF" }}>{outLabel}</div>
          </div>
        </div>

        {/* 현재 상태 문구 */}
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 4 }}>현재 상태</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: onBreak ? "var(--warning)" : working ? "var(--success)" : "var(--text)" }}>
            {onBreak
              ? `외출 중 · ${openBreak!.reason} (${hhmm(openBreak!.startAt)}~)`
              : working
                ? "근무 중"
                : "출근 전"}
          </div>
          {working && (
            <div style={{ fontSize: 14, color: "var(--text-sub)", marginTop: 4 }}>
              {workModeLabel(open!.workMode)} · 현재까지 실근무 {formatMinutes(workedMinutes(open!))}
            </div>
          )}
        </div>

        {!working && <ClockInPanel />}

        {working && !onBreak && (
          <>
            <form action={clockOut} style={{ marginBottom: 10 }}>
              <button type="submit" style={bigBtn("var(--danger)")}>퇴근하기</button>
            </form>
            {/* 외출: 사유 선택 + 외출 시작 */}
            <form action={startBreak} style={{ display: "flex", gap: 8 }}>
              <select name="reason" defaultValue="식사" style={{ flex: 1, height: 48, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 10, fontFamily: "inherit", fontSize: 15, background: "#fff" }}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button type="submit" style={{ width: 110, height: 48, border: "1px solid var(--border)", borderRadius: 10, background: "#fff", color: "var(--text)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
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
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 14, textAlign: "center" }}>
            외출 시간은 실근무시간에서 제외됩니다.
          </div>
        )}
      </div>

      {/* 오늘 기록 */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>오늘 기록</div>
        {todays.length === 0 ? (
          <div style={{ fontSize: 14, color: "var(--text-sub)" }}>아직 오늘 출근 기록이 없습니다.</div>
        ) : (
          todays.map((rec) => {
            const done = Boolean(rec.clockOut);
            return (
              <div key={rec.id} style={{ padding: "14px 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 11, marginBottom: 8, fontSize: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>출근 {hhmm(rec.clockIn)}</span>
                  <span style={{ color: done ? "var(--text)" : "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
                    {done ? `퇴근 ${hhmm(rec.clockOut!)}` : "근무 중"}
                  </span>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", background: "#F3F4F6", padding: "2px 8px", borderRadius: 999 }}>
                    {workModeLabel(rec.workMode)}
                  </span>
                  {rec.workMode === "office" && rec.locationStatus && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: rec.locationStatus === "verified" ? "var(--success)" : "var(--warning)", background: rec.locationStatus === "verified" ? "#DCFCE7" : "#FEF3C7" }}>
                      {locationStatusLabel(rec.locationStatus)}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-sub)", display: "flex", justifyContent: "space-between" }}>
                  <span>외출 {rec.breaks.length}회</span>
                  <span style={{ fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>
                    실근무 {formatMinutes(workedMinutes(rec))}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </AppShell>
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
