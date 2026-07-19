"use client";
// 로그인 이력(관리자) — 공통 기간 달력 + 통합검색 + KPI + 엑셀 내보내기.
//  · 데이터·회사격리·권한·기간조회는 서버(page.tsx)가 책임. 여기선 목록 필터·표시만.
import { useMemo, useState } from "react";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";

export type LoginRow = {
  id: string;
  timeText: string;
  name: string;
  email: string;
  kind: string; // login | login_fail | logout
  kindLabel: string;
  device: string;
  ip: string;
  result: string; // success | fail | blocked
  resultLabel: string;
  metaLabel: string;
  search: string;
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle", whiteSpace: "nowrap" };

// 결과 배지 색
const RESULT_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  success: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  fail: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
  blocked: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

export function LoginHistoryClient({
  rows,
  from,
  to,
  todayISO,
  exportBase,
  capped,
}: {
  rows: LoginRow[];
  from: string;
  to: string;
  todayISO: string;
  exportBase: string;
  capped: boolean;
}) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const terms = queryTerms(q);
    if (!terms.length) return rows;
    return rows.filter((r) => matchesTerms(r.search, terms));
  }, [rows, q]);

  // KPI는 "화면에 보이는" 기준(검색 반영).
  const okCount = shown.filter((r) => r.kind === "login").length;
  const failCount = shown.filter((r) => r.kind === "login_fail").length;
  const outCount = shown.filter((r) => r.kind === "logout").length;

  const kpis = [
    { label: "로그인 성공", value: okCount, color: "var(--text)" },
    { label: "로그인 실패", value: failCount, color: failCount > 0 ? "var(--danger)" : "var(--text)" },
    { label: "로그아웃", value: outCount, color: "var(--text-sub)" },
  ];

  const exportHref = q.trim() ? `${exportBase}&q=${encodeURIComponent(q)}` : exportBase;

  return (
    <div>
      {/* 상단: 기간 달력 + 검색(왼쪽) / 엑셀(오른쪽) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <RangeCalendarNav from={from} to={to} todayISO={todayISO} basePath="/security/logins" />
          <div style={{ minWidth: 220, flex: "0 1 auto" }}>
            <SearchBox value={q} onChange={setQ} placeholder="이름·이메일·IP·기기 검색" />
          </div>
        </div>
        <a
          href={exportHref}
          style={{ height: 40, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          ⬇ 엑셀 내보내기
        </a>
      </div>

      {/* KPI 3개 */}
      <div className="kpi-grid-3" style={{ marginBottom: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color }}>
              {k.value}<span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>건</span>
            </div>
          </div>
        ))}
      </div>

      {/* 안내 */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        로그인·로그아웃 접속 기록입니다. <b>IP는 실제 운영 서버(외부 접속)에서만 정확</b>하며, 개발 환경에서는 내부 주소로 보일 수 있습니다.
        {capped && <> · <b style={{ color: "var(--danger)" }}>결과가 2,000건을 넘어 일부만 표시</b>됩니다. 기간을 좁혀 보세요.</>}
      </div>

      {/* 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>시각</th>
                <th style={th}>이름</th>
                <th style={th}>동작</th>
                <th style={th}>기기</th>
                <th style={th}>IP</th>
                <th style={th}>결과</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {rows.length === 0 ? "이 기간에 접속 기록이 없습니다." : "검색 결과가 없습니다."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => {
                  const s = RESULT_STYLE[r.result] ?? RESULT_STYLE.success;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: "var(--text-sub)" }}>{r.timeText}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        {r.email && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.email}</div>}
                      </td>
                      <td style={td}>
                        {r.kindLabel}
                        {r.metaLabel && <span style={{ fontSize: 12, color: "var(--text-sub)", marginLeft: 6 }}>({r.metaLabel})</span>}
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{r.device}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.ip}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{r.resultLabel}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
