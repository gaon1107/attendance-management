// 근태 리포트 (관리자 전용) — 일/주/월 실근무 집계 + 법정기록 CSV 내보내기. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
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

  // 요약 지표 (실제 집계값만)
  const totalMinutes = summary.reduce((s, u) => s + u.minutes, 0);
  const avgMinutes = summary.length > 0 ? Math.round(totalMinutes / summary.length) : 0;

  const prev = toISODate(shiftAnchor(unit, anchor, -1));
  const next = toISODate(shiftAnchor(unit, anchor, 1));
  const exportHref = `/reports/export?unit=${unit}&date=${toISODate(anchor)}`;

  const kpis = [
    { label: "집계 인원", value: `${summary.length}`, unit: "명" },
    { label: "총 실근무", value: formatMinutes(totalMinutes), unit: "" },
    { label: "1인 평균 실근무", value: formatMinutes(avgMinutes), unit: "" },
  ];

  const navBtn: React.CSSProperties = {
    width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)",
    textDecoration: "none", fontWeight: 700,
  };
  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px" };
  const td: React.CSSProperties = { padding: "13px 20px", fontSize: 15, verticalAlign: "middle" };

  const csvBtn = (
    <Link
      href={exportHref}
      style={{ height: 38, padding: "0 16px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
    >
      ⬇ 법정기록 CSV 내보내기
    </Link>
  );

  return (
    <AppShell user={me} active="reports" title="근태 리포트" subtitle={me.company.name} right={csvBtn}>
      {/* 기간 이동 + 단위 탭 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href={`/reports?unit=${unit}&date=${prev}`} style={navBtn}>◀</Link>
          <div style={{ fontSize: 18, fontWeight: 700, minWidth: 170, textAlign: "center" }}>{label}</div>
          <Link href={`/reports?unit=${unit}&date=${next}`} style={navBtn}>▶</Link>
        </div>
        <div style={{ display: "inline-flex", background: "#EEF2F7", borderRadius: 8, padding: 3 }}>
          {UNITS.map((u) => {
            const on = u.key === unit;
            return (
              <Link
                key={u.key}
                href={`/reports?unit=${u.key}&date=${toISODate(anchor)}`}
                style={{ height: 34, padding: "0 18px", display: "inline-flex", alignItems: "center", borderRadius: 6, fontSize: 15, fontWeight: 700, textDecoration: "none", background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--text-sub)", boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}
              >
                {u.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid-3" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
              {k.value}
              {k.unit && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 집계 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={{ ...th, textAlign: "right" }}>근무일수</th>
                <th style={{ ...th, textAlign: "right" }}>실근무 합계</th>
                <th style={{ ...th, textAlign: "right" }}>외출</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    이 기간에 출퇴근 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                summary.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                          {s.name.slice(0, 1)}
                        </div>
                        <span style={{ fontWeight: 700 }}>
                          {s.name}
                          {s.role === "admin" && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}> (관리자)</span>}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.days.size}일</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{formatMinutes(s.minutes)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.breaks}회</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.6 }}>
        실근무 = (퇴근−출근) − 외출. 근무 중인 기록은 현재 시각까지로 계산됩니다.
        CSV 내보내기는 날짜별 상세(출근·퇴근·근무형태)를 담아 법정 근로기록 증빙에 쓸 수 있습니다.
      </div>
    </AppShell>
  );
}
