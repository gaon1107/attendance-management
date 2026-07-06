// 근태 현황 조회(전체) — 관리자 전용. 기간 내 모든 출퇴근 기록을 한 줄씩 보여주고,
// 이름을 누르면 그 직원의 상세(/records/[userId])로 이동한다. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { PeriodNav } from "@/app/components/PeriodNav";
import { workedMinutes, formatMinutes, isLate } from "@/lib/worktime";
import { normalizeUnit, parseAnchor, rangeFor, toISODate } from "@/lib/period";
import { workModeLabel, locationLabel, hhmm, monthDayDow } from "@/lib/labels";

export default async function RecordsPage({
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
  const anchorISO = toISODate(anchor);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, lateGraceMin: true },
  });

  const rows = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true },
    orderBy: { clockIn: "desc" },
  });

  // 실제 데이터로만 집계
  const total = rows.length;
  const working = rows.filter((r) => !r.clockOut).length;
  let lateCount = 0;
  for (const r of rows) {
    if (isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0)) lateCount++;
  }
  const hasRule = !!company?.workStartTime;

  const kpis = [
    { label: "출근 기록", value: `${total}`, unit: "건", color: "var(--text)" },
    { label: "지각", value: hasRule ? `${lateCount}` : "—", unit: hasRule ? "건" : "", color: lateCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "근무 중", value: `${working}`, unit: "명", color: working > 0 ? "var(--success)" : "var(--text)" },
  ];

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

  return (
    <AppShell user={me} active="records" title="근태 현황" subtitle={me.company.name}>
      <PeriodNav basePath="/records" unit={unit} anchor={anchor} label={label} />

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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>날짜</th>
                <th style={th}>이름</th>
                <th style={th}>근무형태</th>
                <th style={th}>위치</th>
                <th style={th}>출근</th>
                <th style={th}>퇴근</th>
                <th style={th}>지각</th>
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
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{monthDayDow(r.clockIn)}</td>
                      <td style={td}>
                        <Link href={`/records/${r.userId}?unit=${unit}&date=${anchorISO}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text)" }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                            {r.user.name.slice(0, 1)}
                          </div>
                          <span style={{ fontWeight: 700 }}>{r.user.name}</span>
                        </Link>
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{workModeLabel(r.workMode)}</td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{locationLabel(r.locationStatus)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{hhmm(r.clockIn)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.clockOut ? "var(--text)" : "var(--text-sub)" }}>
                        {r.clockOut ? hhmm(r.clockOut) : "근무 중"}
                      </td>
                      <td style={td}>
                        {late === null ? (
                          <span style={{ color: "#9CA3AF" }}>—</span>
                        ) : late ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#FEF3C7" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>지각</span>
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>정상</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>
                        {formatMinutes(workedMinutes(r))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.6 }}>
        이름을 누르면 그 직원의 날짜별 상세 기록을 볼 수 있습니다. 지각 판정은 [설정 → 근무제·기준시간]을 정해야 표시됩니다.
      </div>
    </AppShell>
  );
}
