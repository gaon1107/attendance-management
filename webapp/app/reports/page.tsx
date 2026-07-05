// 근태 리포트 (관리자 전용) — 일/주/월 실근무 집계 + 법정기록 CSV 내보내기.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { TopNav } from "@/app/components/TopNav";
import { workedMinutes, formatMinutes } from "@/lib/worktime";
import { normalizeUnit, parseAnchor, rangeFor, shiftAnchor, toISODate, type Unit } from "@/lib/period";

const UNITS: { key: Unit; label: string }[] = [
  { key: "day", label: "일" },
  { key: "week", label: "주" },
  { key: "month", label: "월" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; date?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const unit = normalizeUnit(sp.unit);
  const anchor = parseAnchor(sp.date);
  const { start, end, label } = rangeFor(unit, anchor);

  // 기간 내 우리 회사 출퇴근 기록
  const rows = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true },
    orderBy: { clockIn: "asc" },
  });

  // 직원별 집계
  const byUser = new Map<string, { name: string; role: string; minutes: number; breaks: number; days: Set<string> }>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? { name: r.user.name, role: r.user.role, minutes: 0, breaks: 0, days: new Set<string>() };
    cur.minutes += workedMinutes(r);
    cur.breaks += r.breaks.length;
    cur.days.add(toISODate(r.clockIn));
    byUser.set(r.userId, cur);
  }
  const summary = [...byUser.values()].sort((a, b) => b.minutes - a.minutes);

  const prev = toISODate(shiftAnchor(unit, anchor, -1));
  const next = toISODate(shiftAnchor(unit, anchor, 1));
  const exportHref = `/reports/export?unit=${unit}&date=${toISODate(anchor)}`;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    textDecoration: "none",
    color: active ? "#fff" : "var(--text)",
    background: active ? "var(--primary)" : "#fff",
    border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
  });
  const navBtn: React.CSSProperties = {
    width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)",
    textDecoration: "none", fontWeight: 700,
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav user={me} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>근태 리포트</h1>
          <Link href={exportHref} style={{ height: 40, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
            ⬇ 법정기록 CSV 내보내기
          </Link>
        </div>

        {/* 단위 탭 + 기간 이동 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {UNITS.map((u) => (
            <Link key={u.key} href={`/reports?unit=${u.key}&date=${toISODate(anchor)}`} style={tabStyle(u.key === unit)}>
              {u.label}
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <Link href={`/reports?unit=${unit}&date=${prev}`} style={navBtn}>◀</Link>
          <div style={{ fontSize: 15, fontWeight: 700, minWidth: 160, textAlign: "center" }}>{label}</div>
          <Link href={`/reports?unit=${unit}&date=${next}`} style={navBtn}>▶</Link>
        </div>

        {/* 집계 표 */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.2fr 1fr", padding: "12px 20px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", background: "#F9FAFB" }}>
            <div>이름</div>
            <div>근무일수</div>
            <div>실근무 합계</div>
            <div>외출</div>
          </div>
          {summary.length === 0 ? (
            <div style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
              이 기간에 출퇴근 기록이 없습니다.
            </div>
          ) : (
            summary.map((s, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.2fr 1fr", padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, alignItems: "center" }}>
                <div style={{ fontWeight: 700 }}>
                  {s.name}
                  <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}>{s.role === "admin" ? " (관리자)" : ""}</span>
                </div>
                <div>{s.days.size}일</div>
                <div style={{ fontWeight: 700, color: "var(--primary)" }}>{formatMinutes(s.minutes)}</div>
                <div>{s.breaks}회</div>
              </div>
            ))
          )}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12 }}>
          실근무 = (퇴근−출근) − 외출. 근무 중인 기록은 현재 시각까지로 계산됩니다.
          CSV 내보내기는 날짜별 상세(출근·퇴근·근무형태)를 담아 법정 근로기록 증빙에 쓸 수 있습니다.
        </div>
      </main>
    </div>
  );
}
