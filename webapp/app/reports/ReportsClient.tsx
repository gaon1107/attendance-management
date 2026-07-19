"use client";
// 근태 리포트 표 + 검색 (클라이언트) — 공통 컴포넌트 조합: 기간 달력(RangeCalendar) + 통합검색(SearchBox/lib.search).
//  · 기간(from~to)은 URL로 서버 조회 → 달력 [적용] 시 router.push 로 서버가 그 기간 집계를 다시 계산한다.
//  · 통합검색은 브라우저에서 즉시 필터(서버 왕복 없음). 여러 단어는 공백/쉼표로 구분해 OR 검색.
//  · KPI(집계인원·총실근무·1인평균·총초과근무)도 걸러진 목록 기준으로 함께 갱신된다.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RangeCalendar } from "@/app/components/RangeCalendar";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";
import { formatMinutes } from "@/lib/worktime";

// 서버(page.tsx)에서 미리 계산해 넘겨주는 직원 한 명의 집계값(직렬화 가능한 순수 객체)
export type ReportRow = {
  id: string;
  name: string;
  employeeNo: string | null; // 사번(동명이인 구분·검색용)
  initial: string;
  isAdmin: boolean;
  days: number; // 근무일수
  minutes: number; // 실근무 합계(분)
  overtime: number; // 초과근무(분)
  absent: number; // 결근(일)
  breaks: number; // 외출(회)
  search: string; // 검색용(이름 등)을 소문자로 합친 문자열
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "13px 20px", fontSize: 15, verticalAlign: "middle" };

export function ReportsClient({
  rows,
  from,
  to,
  todayISO,
  standardWorkHours,
  exportBase,
}: {
  rows: ReportRow[];
  from: string;
  to: string;
  todayISO: string;
  standardWorkHours: number;
  exportBase: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  // ── 통합검색(OR) — 공통 로직(lib/search) ─────────────────────────────
  const filtered = useMemo(() => {
    const terms = queryTerms(q);
    return rows.filter((r) => matchesTerms(r.search, terms));
  }, [q, rows]);

  // 엑셀 내보내기 링크 — 현재 검색어(q)를 그대로 서버에 전달해 "화면에 보이는 직원만" 내보낸다.
  const exportHref = q.trim() ? `${exportBase}&q=${encodeURIComponent(q)}` : exportBase;
  // 법정기록 PDF(인쇄용 화면) 링크 — 엑셀과 같은 기간·검색어를 그대로 넘긴다.
  const printBase = `/reports/print?from=${from}&to=${to}`;
  const printHref = q.trim() ? `${printBase}&q=${encodeURIComponent(q)}` : printBase;

  // KPI는 걸러진 목록 기준으로 계산
  const totalMinutes = filtered.reduce((s, u) => s + u.minutes, 0);
  const avgMinutes = filtered.length > 0 ? Math.round(totalMinutes / filtered.length) : 0;
  const totalOvertime = filtered.reduce((s, u) => s + u.overtime, 0);

  const kpis = [
    { label: "집계 인원", value: `${filtered.length}`, unit: "명" },
    { label: "총 실근무", value: formatMinutes(totalMinutes), unit: "" },
    { label: "1인 평균 실근무", value: formatMinutes(avgMinutes), unit: "" },
    { label: `총 초과근무 (기준 ${standardWorkHours}h)`, value: totalOvertime > 0 ? formatMinutes(totalOvertime) : "0분", unit: "" },
  ];

  return (
    <>
      {/* 검색바: 공통 기간달력 + 공통 통합검색(실시간) + 엑셀 내보내기(검색어 반영) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <RangeCalendar from={from} to={to} todayISO={todayISO} onApply={(f, t) => router.push(`/reports?from=${f}&to=${t}`)} />
        <SearchBox value={q} onChange={setQ} />
        <Link
          href={printHref}
          prefetch={false}
          style={{ marginLeft: "auto", height: 38, padding: "0 16px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: "#fff", color: "var(--primary)", border: "1px solid var(--primary)", fontSize: 15, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          🖨 법정기록 PDF
        </Link>
        <Link
          href={exportHref}
          prefetch={false}
          style={{ height: 38, padding: "0 16px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          ⬇ 법정기록 엑셀 내보내기
        </Link>
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
                <th style={th}>사번</th>
                <th style={{ ...th, textAlign: "right" }}>근무일수</th>
                <th style={{ ...th, textAlign: "right" }}>실근무 합계</th>
                <th style={{ ...th, textAlign: "right" }}>초과근무</th>
                <th style={{ ...th, textAlign: "right" }}>결근</th>
                <th style={{ ...th, textAlign: "right" }}>외출</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "이 기간에 출퇴근 기록이 없습니다."}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                          {s.initial}
                        </div>
                        <span style={{ fontWeight: 700 }}>
                          {s.name}
                          {s.isAdmin && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}> (관리자)</span>}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{s.employeeNo || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.days}일</td>
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
    </>
  );
}
