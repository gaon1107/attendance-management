// 근태 현황 조회(전체) — 관리자 전용. 시작~종료 날짜(달력)로 기간을 정하고, 통합 검색어로 목록을 거른다.
// 이름을 누르면 그 직원의 상세(/records/[userId])로 이동한다. (리뉴얼 디자인)
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { RecordsSearchBar } from "@/app/components/RecordsSearchBar";
import { workedMinutes, formatMinutes, isLate } from "@/lib/worktime";
import { parseAnchor, toISODate } from "@/lib/period";
import { workModeLabel, locationLabel, hhmm, monthDayDow } from "@/lib/labels";
import { effectiveWorkDays, isWorkDay } from "@/lib/workdays";
import { after } from "next/server";
import { purgeExpiredPhotos } from "@/lib/clock-photo";

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 출퇴근 사진 90일 자동 파기의 정기 트리거 — 관리자가 근태 현황을 열 때(하루 1회만 실제 동작),
  // 화면 응답을 보낸 뒤(after) 실행되어 조회 속도에 영향 없음.
  after(() => purgeExpiredPhotos());

  const sp = await searchParams;
  // 기본 기간: 오늘 하루. from/to는 "YYYY-MM-DD"(달력 값).
  const todayISO = toISODate(new Date());
  const fromISO = sp.from || todayISO;
  const toISO = sp.to || todayISO;
  const q = (sp.q ?? "").trim();

  // 조회 기간(시작 이상 ~ 종료 다음날 미만 = 종료일 포함). from>to면 종료를 시작으로 맞춘다.
  const start = parseAnchor(fromISO);
  start.setHours(0, 0, 0, 0);
  let endDay = parseAnchor(toISO);
  endDay.setHours(0, 0, 0, 0);
  if (endDay < start) endDay = new Date(start);
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  // 과도한 전량 로드 방지: 조회 폭을 최대 92일로 제한(초과 시 잘라내고 화면에 안내)
  const MAX_DAYS = 92;
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + MAX_DAYS);
  const rangeCapped = end > maxEnd;
  if (rangeCapped) end = maxEnd;

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, lateGraceMin: true, workDays: true },
  });

  const rows = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true, clockPhotos: { select: { livenessStatus: true } } },
    orderBy: { clockIn: "asc" }, // 오래된 것이 위로(시간 흐름 순)
  });

  // 각 기록을 화면 표시값으로 미리 계산 → 통합 검색은 "화면에 보이는 모든 컬럼"의 글자로 판단한다.
  const view = rows.map((r) => {
    const onWorkDay = isWorkDay(r.clockIn, effectiveWorkDays(r.user.workDays, company?.workDays));
    const holiday = !onWorkDay;
    const late = onWorkDay ? isLate(r.clockIn, company?.workStartTime ?? null, company?.lateGraceMin ?? 0) : null;
    const suspect = r.clockPhotos.some((p) => p.livenessStatus === "suspect");
    const review = !suspect && r.clockPhotos.some((p) => p.livenessStatus === "error");
    const outStr = r.clockOut ? hhmm(r.clockOut) : "근무 중";
    const lateText = holiday ? "휴일근무" : late === null ? "" : late ? "지각" : "정상";
    const worked = formatMinutes(workedMinutes(r));
    const badge = suspect ? "위조 의심" : review ? "확인 필요" : "";
    // 날짜·이름·근무형태·위치·출근·퇴근·지각·실근무·위조표시 모두 합쳐 소문자로 — 어느 컬럼이든 검색되게
    const searchText = [
      monthDayDow(r.clockIn), r.user.name, workModeLabel(r.workMode), locationLabel(r.locationStatus),
      hhmm(r.clockIn), outStr, lateText, worked, badge,
    ].join(" ").toLowerCase();
    return { r, onWorkDay, holiday, late, suspect, review, outStr, lateText, worked, badge, searchText };
  });

  const needle = q.toLowerCase();
  const filtered = needle ? view.filter((v) => v.searchText.includes(needle)) : view;

  // 관리자 확인이 필요한 건: 위조 의심(suspect=빨강) / 판독 실패(review=주황). KPI·배너는 걸러진 목록 기준.
  const suspectCount = filtered.filter((v) => v.suspect).length;
  const reviewCount = filtered.filter((v) => v.review).length;

  // 대기 중인 근태 정정 요청 수(상단 버튼 배지용)
  const pendingCorrectionCount = await prisma.attendanceCorrection.count({
    where: { companyId: me.companyId, status: "pending" },
  });

  const correctionBtn = (
    <Link
      href="/corrections/approvals"
      style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: pendingCorrectionCount > 0 ? "var(--primary)" : "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
    >
      📝 근태 정정 승인{pendingCorrectionCount > 0 ? ` ${pendingCorrectionCount}` : ""}
    </Link>
  );

  // 실제 데이터로만 집계(걸러진 목록 기준) — 지각은 근무일 + 기준시각 이후일 때만
  const total = filtered.length;
  // "근무 중"은 지금 이 순간 기준 — 오늘 출근했고 아직 퇴근 안 한 사람만(과거 미퇴근 기록이 부풀리지 않게)
  const working = filtered.filter((v) => !v.r.clockOut && toISODate(v.r.clockIn) === todayISO).length;
  const lateCount = filtered.filter((v) => v.late === true).length;
  const hasRule = !!company?.workStartTime;

  const kpis = [
    { label: "출근 기록", value: `${total}`, unit: "건", color: "var(--text)" },
    { label: "지각", value: hasRule ? `${lateCount}` : "—", unit: hasRule ? "건" : "", color: lateCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "근무 중", value: `${working}`, unit: "명", color: working > 0 ? "var(--success)" : "var(--text)" },
  ];

  const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

  return (
    <AppShell user={me} active="records" title="근태 현황" subtitle={me.company.name} right={correctionBtn}>
      <RecordsSearchBar from={fromISO} to={toISO} q={q} />

      {rangeCapped && (
        <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, fontWeight: 700, color: "#B45309" }}>
          검색 기간이 너무 길어 시작일부터 최대 {MAX_DAYS}일까지만 표시합니다.
        </div>
      )}

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

      {(suspectCount > 0 || reviewCount > 0) && (
        <div style={{ background: suspectCount > 0 ? "#FEE2E2" : "#FEF3C7", border: `1px solid ${suspectCount > 0 ? "#FCA5A5" : "#FCD34D"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 14, fontWeight: 700, color: suspectCount > 0 ? "#B91C1C" : "#B45309" }}>
          ⚠ {q ? "검색된 목록 중" : "이 기간에"}{suspectCount > 0 ? ` 위조 의심 ${suspectCount}건` : ""}{suspectCount > 0 && reviewCount > 0 ? "," : ""}{reviewCount > 0 ? ` 확인 필요(판독 실패) ${reviewCount}건` : ""}이 있습니다. 이름 옆 표시를 눌러 사진을 확인하세요.
        </div>
      )}

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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q ? "검색 결과가 없습니다." : "이 기간에 출퇴근 기록이 없습니다."}
                  </td>
                </tr>
              ) : (
                filtered.map((v) => {
                  const r = v.r;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{monthDayDow(r.clockIn)}</td>
                      <td style={td}>
                        <Link href={`/records/${r.userId}?date=${fromISO}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text)" }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                            {r.user.name.slice(0, 1)}
                          </div>
                          <span style={{ fontWeight: 700 }}>{r.user.name}</span>
                          {v.suspect ? (
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#B91C1C", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                              ⚠ 위조 의심
                            </span>
                          ) : v.review ? (
                            <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#D97706", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>
                              ❓ 확인 필요
                            </span>
                          ) : null}
                        </Link>
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{workModeLabel(r.workMode)}</td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{locationLabel(r.locationStatus)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{hhmm(r.clockIn)}</td>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.clockOut ? "var(--text)" : "var(--text-sub)" }}>
                        {v.outStr}
                      </td>
                      <td style={td}>
                        {v.holiday ? (
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#6D28D9" }}>휴일근무</span>
                        ) : v.late === null ? (
                          <span style={{ color: "#9CA3AF" }}>—</span>
                        ) : v.late ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#FEF3C7" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>지각</span>
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>정상</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>
                        {v.worked}
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
