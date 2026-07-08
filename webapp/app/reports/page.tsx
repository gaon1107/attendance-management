// 근태 리포트 (관리자 전용) — 일/주/월 실근무 집계 + 법정기록 CSV 내보내기. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { workedMinutes, formatMinutes } from "@/lib/worktime";
import { normalizeUnit, parseAnchor, rangeFor, shiftAnchor, toISODate, type Unit } from "@/lib/period";
import { effectiveWorkDays, isWorkDay } from "@/lib/workdays";
import { leaveDateSet } from "@/lib/leave";

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

  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { workDays: true, standardWorkHours: true } });
  // 초과근무 판정 기준 = 기준 일 근무시간(분). 하루 실근무가 이보다 많으면 초과분을 연장으로 집계.
  const standardMin = Math.round((company?.standardWorkHours ?? 8) * 60);

  // 기간 내 우리 회사 출퇴근 기록
  const rows = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true },
    orderBy: { clockIn: "asc" },
  });

  // 직원별 집계 (+ 초과근무를 위해 날짜별 실근무 분도 모은다)
  const byUser = new Map<string, { id: string; name: string; role: string; minutes: number; breaks: number; days: Set<string>; workDays: string | null; dayMinutes: Map<string, number> }>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? { id: r.userId, name: r.user.name, role: r.user.role, minutes: 0, breaks: 0, days: new Set<string>(), workDays: r.user.workDays, dayMinutes: new Map<string, number>() };
    const wm = workedMinutes(r);
    const iso = toISODate(r.clockIn);
    cur.minutes += wm;
    cur.breaks += r.breaks.length;
    cur.days.add(iso);
    cur.dayMinutes.set(iso, (cur.dayMinutes.get(iso) ?? 0) + wm); // 같은 날 여러 기록이면 합산
    byUser.set(r.userId, cur);
  }

  // 초과근무 = 날짜별로 (그 날 실근무 − 기준 일 근무시간)이 양수면 그 합. 기준 이하인 날은 0.
  function overtimeMinutesOf(dayMinutes: Map<string, number>): number {
    let ot = 0;
    for (const dm of dayMinutes.values()) ot += Math.max(0, dm - standardMin);
    return ot;
  }

  // 기간에 걸치는 승인된 휴가 → 직원별 휴가일 집합(결근에서 제외)
  const leaves = await prisma.leaveRequest.findMany({
    where: { companyId: me.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
    select: { userId: true, startDate: true, endDate: true },
  });
  const leaveByUser = new Map<string, Set<string>>();
  for (const [uid, list] of Object.entries(
    leaves.reduce<Record<string, { startDate: Date; endDate: Date }[]>>((acc, l) => {
      (acc[l.userId] ??= []).push(l);
      return acc;
    }, {})
  )) {
    leaveByUser.set(uid, leaveDateSet(list));
  }

  // 결근 = 과거(오늘 이전) 근무일 중 출근 기록도 없고 승인 휴가도 아닌 날
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const absLimit = end < startOfToday ? end : startOfToday;
  function absentCountFor(userWorkDays: string | null, attended: Set<string>, leaveDays: Set<string>): number {
    const wd = effectiveWorkDays(userWorkDays, company?.workDays);
    let n = 0;
    for (let cur = new Date(start); cur < absLimit; cur = new Date(cur.getTime() + 86400000)) {
      const iso = toISODate(cur);
      if (isWorkDay(cur, wd) && !attended.has(iso) && !leaveDays.has(iso)) n++;
    }
    return n;
  }

  const summary = [...byUser.values()]
    .map((u) => ({ ...u, absent: absentCountFor(u.workDays, u.days, leaveByUser.get(u.id) ?? new Set()), overtime: overtimeMinutesOf(u.dayMinutes) }))
    .sort((a, b) => b.minutes - a.minutes);

  // 요약 지표 (실제 집계값만)
  const totalMinutes = summary.reduce((s, u) => s + u.minutes, 0);
  const avgMinutes = summary.length > 0 ? Math.round(totalMinutes / summary.length) : 0;
  const totalOvertime = summary.reduce((s, u) => s + u.overtime, 0);

  const prev = toISODate(shiftAnchor(unit, anchor, -1));
  const next = toISODate(shiftAnchor(unit, anchor, 1));
  const exportHref = `/reports/export?unit=${unit}&date=${toISODate(anchor)}`;

  const kpis = [
    { label: "집계 인원", value: `${summary.length}`, unit: "명" },
    { label: "총 실근무", value: formatMinutes(totalMinutes), unit: "" },
    { label: "1인 평균 실근무", value: formatMinutes(avgMinutes), unit: "" },
    { label: `총 초과근무 (기준 ${company?.standardWorkHours ?? 8}h)`, value: totalOvertime > 0 ? formatMinutes(totalOvertime) : "0분", unit: "" },
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
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 660 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={{ ...th, textAlign: "right" }}>근무일수</th>
                <th style={{ ...th, textAlign: "right" }}>실근무 합계</th>
                <th style={{ ...th, textAlign: "right" }}>초과근무</th>
                <th style={{ ...th, textAlign: "right" }}>결근</th>
                <th style={{ ...th, textAlign: "right" }}>외출</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
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
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: s.overtime > 0 ? "var(--warning)" : "var(--text-sub)" }}>{s.overtime > 0 ? formatMinutes(s.overtime) : "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: s.absent > 0 ? "var(--danger)" : "var(--text-sub)" }}>{s.absent}일</td>
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
        초과근무 = 하루 실근무가 [설정 → 기준 일 근무시간]({company?.standardWorkHours ?? 8}시간)을 넘은 날의 초과분 합계입니다.
        CSV 내보내기는 날짜별 상세(출근·퇴근·근무형태)를 담아 법정 근로기록 증빙에 쓸 수 있습니다.
      </div>
    </AppShell>
  );
}
