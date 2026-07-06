// 직원별 근태 상세 — 관리자 전용. 특정 직원의 기간 내 날짜별 출퇴근/외출/실근무/지각. (리뉴얼 디자인)
// ※ 회사 격리: userId가 내 회사 소속이 아니면 보여주지 않는다(notFound).
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { PeriodNav } from "@/app/components/PeriodNav";
import { workedMinutes, formatMinutes, isLate } from "@/lib/worktime";
import { normalizeUnit, parseAnchor, rangeFor } from "@/lib/period";
import { workModeLabel, locationLabel, hhmm, monthDayDow } from "@/lib/labels";

export default async function RecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ unit?: string; date?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const { userId } = await params;
  // 회사 격리 — 반드시 내 회사 소속 직원만 조회
  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: me.companyId },
  });
  if (!target) notFound();

  const sp = await searchParams;
  const unit = normalizeUnit(sp.unit);
  const anchor = parseAnchor(sp.date);
  const { start, end, label } = rangeFor(unit, anchor);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, lateGraceMin: true },
  });

  const rows = await prisma.attendance.findMany({
    where: { userId: target.id, companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { breaks: true },
    orderBy: { clockIn: "desc" },
  });

  // 실제 데이터로만 집계
  const totalMinutes = rows.reduce((s, r) => s + workedMinutes(r), 0);
  const days = new Set(rows.map((r) => monthDayDow(r.clockIn))).size;
  let lateCount = 0;
  for (const r of rows) {
    if (isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0)) lateCount++;
  }
  const hasRule = !!company?.workStartTime;

  const kpis = [
    { label: "근무일수", value: `${days}`, unit: "일", color: "var(--text)" },
    { label: "실근무 합계", value: formatMinutes(totalMinutes), unit: "", color: "var(--primary)" },
    { label: "지각", value: hasRule ? `${lateCount}` : "—", unit: hasRule ? "건" : "", color: lateCount > 0 ? "var(--warning)" : "var(--text)" },
  ];

  const backBtn = (
    <Link href="/records" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 근태 현황
    </Link>
  );

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

  return (
    <AppShell user={me} active="records" title={`${target.name} 님 근태 상세`} subtitle={me.company.name} right={backBtn}>
      <PeriodNav basePath={`/records/${target.id}`} unit={unit} anchor={anchor} label={label} />

      <div className="kpi-grid-3" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}
              {k.unit && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>날짜</th>
                <th style={th}>근무형태</th>
                <th style={th}>위치</th>
                <th style={th}>출근</th>
                <th style={th}>퇴근</th>
                <th style={th}>지각</th>
                <th style={{ ...th, textAlign: "right" }}>외출</th>
                <th style={{ ...th, textAlign: "right" }}>실근무</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    이 기간에 출퇴근 기록이 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const late = isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0);
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{monthDayDow(r.clockIn)}</td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{workModeLabel(r.workMode)}</td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{locationLabel(r.locationStatus)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{hhmm(r.clockIn)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.clockOut ? "var(--text)" : "var(--text-sub)" }}>
                        {r.clockOut ? hhmm(r.clockOut) : "근무 중"}
                      </td>
                      <td style={td}>
                        {late === null ? <span style={{ color: "#9CA3AF" }}>—</span> : late ? <span style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>지각</span> : <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>정상</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-sub)" }}>{r.breaks.length}회</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{formatMinutes(workedMinutes(r))}</td>
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
