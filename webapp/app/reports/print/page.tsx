// 법정 근로기록부 인쇄용 화면(관리자 전용) — 기간 내 근태를 "직원별 근로기록부"로 보여주고
// 브라우저 인쇄 → "PDF로 저장"으로 받게 한다. 새 라이브러리·폰트 없이 @media print CSS만 사용(한글은 브라우저가 렌더).
// 데이터·기간·검색 규칙은 엑셀 내보내기(reports/export)와 동일하게 맞춰 두 산출물이 어긋나지 않게 한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { workedMinutes, formatMinutes } from "@/lib/worktime";
import { workModeLabel, locationStatusLabel } from "@/lib/location";
import { clockOutText } from "@/lib/labels";
import { parseAnchor, toISODate } from "@/lib/period";
import { queryTerms, matchesTerms } from "@/lib/search";
import { DAY_LABELS } from "@/lib/workdays";
import { PrintButton } from "./PrintButton";

function hhmm(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

type DayRow = { date: string; dow: string; workMode: string; location: string; in: string; out: string; breaks: number; worked: number; open: boolean };
type UserBlock = {
  id: string; name: string; role: string; employeeNo: string | null;
  rows: DayRow[];
  days: Set<string>;
  totalWorked: number;
  totalBreaks: number;
  dayMinutes: Map<string, number>; // 초과근무(연장) 소계용: 날짜별 실근무 합
};

export default async function ReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[]; q?: string | string[] }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  // 반복 쿼리(?q=a&q=b)는 값이 배열로 올 수 있다 → 첫 값만 취해 문자열로 고정(엑셀 라우트의 .get()과 동일 동작).
  const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const fromParam = first(sp.from);
  const toParam = first(sp.to);
  const qParam = first(sp.q) ?? "";

  // 기간 파라미터 from/to("YYYY-MM-DD")를 엑셀 라우트·리포트 화면과 동일 규칙으로 검증·보정한다.
  const now = new Date();
  const todayISO = toISODate(now);
  const monthStartISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const normISO = (s: string | undefined, fallback: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T00:00:00");
      if (!Number.isNaN(d.getTime())) return s;
    }
    return fallback;
  };
  const fromISO = normISO(fromParam, monthStartISO);
  let toISO = normISO(toParam, todayISO);
  if (toISO < fromISO) toISO = fromISO;

  const start = parseAnchor(fromISO);
  start.setHours(0, 0, 0, 0);
  const endDay = parseAnchor(toISO);
  endDay.setHours(0, 0, 0, 0);
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  // 엑셀·화면과 동일하게 최대 92일로 제한
  const MAX_DAYS = 92;
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + MAX_DAYS);
  const rangeCapped = end > maxEnd;
  if (rangeCapped) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  // 초과근무 기준 = 기준 일 근무시간(분). 세션에 이미 로드된 회사 정보를 재사용(중복 조회 안 함).
  const standardMin = Math.round((me.company.standardWorkHours ?? 8) * 60);

  const all = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { user: true, breaks: true },
    orderBy: [{ clockIn: "asc" }],
  });

  // 통합검색어(q) — 엑셀·화면과 동일한 OR 규칙으로 직원(이름·역할)을 거른다. 없으면 기간 전체.
  const terms = queryTerms(qParam);
  const rows = terms.length
    ? all.filter((r) => matchesTerms([r.user.name, r.user.employeeNo ?? "", r.user.role === "admin" ? "관리자" : "직원"].join(" ").toLowerCase(), terms))
    : all;

  // 직원별로 묶기(출근 시각 오름차순 유지)
  const byUser = new Map<string, UserBlock>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? {
      id: r.userId, name: r.user.name, role: r.user.role, employeeNo: r.user.employeeNo,
      rows: [], days: new Set<string>(), totalWorked: 0, totalBreaks: 0, dayMinutes: new Map<string, number>(),
    };
    const iso = toISODate(r.clockIn);
    const wm = workedMinutes(r);
    cur.rows.push({
      date: iso,
      dow: DAY_LABELS[r.clockIn.getDay()],
      workMode: workModeLabel(r.workMode),
      location: r.workMode === "office" ? locationStatusLabel(r.locationStatus) : "-",
      in: hhmm(r.clockIn),
      out: r.clockOut ? clockOutText(r.clockIn, r.clockOut) : "",
      breaks: r.breaks.length,
      worked: wm,
      open: !r.clockOut, // 미퇴근(근무 중) — 확정되지 않은 기록임을 표시
    });
    cur.days.add(iso);
    cur.totalWorked += wm;
    cur.totalBreaks += r.breaks.length;
    cur.dayMinutes.set(iso, (cur.dayMinutes.get(iso) ?? 0) + wm);
    byUser.set(r.userId, cur);
  }
  // 초과근무(연장) 소계 = 날짜별 (실근무 − 기준 일 근무시간) 양수 합. 리포트 화면과 같은 정의.
  const overtimeOf = (dm: Map<string, number>): number => {
    let ot = 0;
    for (const v of dm.values()) ot += Math.max(0, v - standardMin);
    return ot;
  };

  const blocks = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const issuedLabel = now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const periodLabel = `${fromISO} ~ ${toISO}`;
  const docTitle = `근로기록부_${me.company.name}_${fromISO}_${toISO}`;

  // ── 스타일(화면/인쇄 공통 + 인쇄 전용) ──
  const th: React.CSSProperties = { border: "1px solid #999", padding: "4px 6px", fontSize: 11, fontWeight: 700, background: "#f3f4f6", textAlign: "center", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { border: "1px solid #bbb", padding: "3px 6px", fontSize: 11, textAlign: "center", whiteSpace: "nowrap" };
  const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div className="rp-root">
      {/* 인쇄용 전역 스타일: 화면에선 툴바·회색배경, 인쇄에선 A4 여백·툴바 숨김·직원마다 새 페이지 */}
      <style>{`
        @page { size: A4; margin: 14mm 12mm; }
        .rp-root { background: #e5e7eb; min-height: 100vh; padding: 24px 0; }
        .rp-toolbar { max-width: 800px; margin: 0 auto 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 0 16px; }
        .rp-sheet { max-width: 800px; margin: 0 auto; background: #fff; padding: 28px 32px; box-shadow: 0 1px 6px rgba(0,0,0,0.15); color: #111; }
        .rp-emp { margin-top: 26px; }
        .rp-emp:first-of-type { margin-top: 0; }
        @media print {
          /* min-height 초기화 — 100vh가 남아 빈 페이지가 딸려 나오는 것 방지 */
          .rp-root { background: #fff; padding: 0; min-height: auto; }
          .rp-toolbar { display: none; }
          /* 좌우 안전 여백(8mm) — 인쇄창에서 '여백 없음'을 골라도 표가 종이 끝에 붙어 잘리지 않게 한다.
             (상하 여백은 페이지마다 적용되는 @page 여백이 담당 → '기본값' 권장) */
          .rp-sheet { max-width: none; margin: 0; padding: 0 8mm; box-shadow: none; }
          .rp-emp + .rp-emp { break-before: page; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>

      <div className="rp-toolbar">
        <a href={`/reports?from=${fromISO}&to=${toISO}`} style={{ fontSize: 14, color: "#374151", textDecoration: "none", fontWeight: 700 }}>← 리포트로</a>
        <PrintButton title={docTitle} />
        <span style={{ fontSize: 13, color: "#6b7280" }}>버튼을 누른 뒤 인쇄 대화상자에서 <b>대상을 &apos;PDF로 저장&apos;</b>으로 선택하세요.</span>
      </div>

      <div className="rp-sheet">
        {/* 문서 머리말 */}
        <div style={{ textAlign: "center", borderBottom: "2px solid #111", paddingBottom: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>근로기록부</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#333", marginBottom: 18 }}>
          <span><b>{me.company.name}</b></span>
          <span>기간: {periodLabel}{rangeCapped ? " (최대 92일로 제한됨)" : ""} · 발행일: {issuedLabel}</span>
        </div>

        {blocks.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: "#666" }}>
            해당 기간에 표시할 근태 기록이 없습니다.
          </div>
        )}

        {blocks.map((b) => (
          <div key={b.id} className="rp-emp">
            {/* 직원 머리말 */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, borderBottom: "1px solid #111", paddingBottom: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{b.name}</span>
              <span style={{ fontSize: 12, color: "#555" }}>{b.role === "admin" ? "관리자" : "직원"}{b.employeeNo ? ` · 사번 ${b.employeeNo}` : ""}</span>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>날짜</th>
                  <th style={th}>요일</th>
                  <th style={th}>근무형태</th>
                  <th style={th}>위치확인</th>
                  <th style={th}>출근(시업)</th>
                  <th style={th}>퇴근(종업)</th>
                  <th style={th}>외출(회)</th>
                  <th style={th}>실근무</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{r.date}</td>
                    <td style={td}>{r.dow}</td>
                    <td style={td}>{r.workMode}</td>
                    <td style={td}>{r.location}</td>
                    <td style={td}>{r.in}</td>
                    <td style={td}>{r.out || "—"}</td>
                    <td style={tdNum}>{r.breaks}</td>
                    <td style={tdNum}>{formatMinutes(r.worked)}{r.open ? " (근무중)" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 직원 소계 */}
            <div style={{ display: "flex", gap: 20, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 6, fontSize: 12, fontWeight: 700 }}>
              <span>근무일수 <b style={{ color: "#1d4ed8" }}>{b.days.size}</b>일</span>
              <span>실근무 합계 <b style={{ color: "#1d4ed8" }}>{formatMinutes(b.totalWorked)}</b></span>
              <span>초과근무 합계 <b style={{ color: "#b45309" }}>{formatMinutes(overtimeOf(b.dayMinutes))}</b></span>
              <span>외출 합계 <b>{b.totalBreaks}</b>회</span>
            </div>
          </div>
        ))}

        {/* 문서 꼬리말 */}
        <div style={{ marginTop: 22, paddingTop: 10, borderTop: "1px solid #ccc", fontSize: 10.5, color: "#666", lineHeight: 1.6 }}>
          · 실근무 = (퇴근−출근) − 외출. 근무 중(미퇴근) 기록은 현재 시각까지로 계산됩니다.
          · 초과근무 = 하루 실근무가 기준 일 근무시간({(standardMin / 60)}시간)을 넘은 날의 초과분 합계.
          · 본 기록은 근로기준법상 근로시간 기록 보존(3년) 증빙용으로 출력할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
