"use client";
// 접속 로그(관리자) — 공통 기간 달력 + 통합검색 + 동작 필터 + KPI + 엑셀 내보내기.
//  · 데이터·회사격리·권한·기간조회·사내망 판정은 서버(page.tsx)가 책임. 여기선 목록 필터·표시만.
import { useMemo, useState } from "react";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";

export type AccessRow = {
  id: string;
  timeText: string;
  name: string;
  email: string;
  kind: string; // login | login_fail | logout | clock_in | clock_out
  kindLabel: string;
  device: string;
  ip: string;
  net: "office" | "outside" | "unknown";
  netLabel: string;
  result: string; // success | fail | blocked
  resultLabel: string;
  metaLabel: string;
  search: string;
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle", whiteSpace: "nowrap" };

// 접속 경로(사내망/외부) 배지 색 — 외부는 주의(주황), 사내망은 성공(초록), 판정불가는 회색.
const NET_STYLE: Record<AccessRow["net"], { bg: string; dot: string; color: string }> = {
  office: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  outside: { bg: "#FEF3C7", dot: "#B45309", color: "#B45309" },
  unknown: { bg: "#F3F4F6", dot: "#9CA3AF", color: "#6B7280" },
};

// 결과 배지 색
const RESULT_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  success: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  fail: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
  blocked: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

// 동작 필터 — 로그인 계열/출퇴근 계열을 나눠 본다.
const KIND_FILTERS = [
  { key: "all", label: "전체", kinds: [] as string[] },
  { key: "auth", label: "로그인", kinds: ["login", "login_fail", "logout"] },
  { key: "clock", label: "출퇴근", kinds: ["clock_in", "clock_out"] },
];

export function AccessLogClient({
  rows,
  from,
  to,
  todayISO,
  exportBase,
  capped,
  hasIpRule,
}: {
  rows: AccessRow[];
  from: string;
  to: string;
  todayISO: string;
  exportBase: string;
  capped: boolean;
  hasIpRule: boolean;
}) {
  const [q, setQ] = useState("");
  const [kindKey, setKindKey] = useState("all");

  const shown = useMemo(() => {
    const filter = KIND_FILTERS.find((f) => f.key === kindKey);
    const byKind = filter && filter.kinds.length ? rows.filter((r) => filter.kinds.includes(r.kind)) : rows;
    const terms = queryTerms(q);
    if (!terms.length) return byKind;
    return byKind.filter((r) => matchesTerms(r.search, terms));
  }, [rows, q, kindKey]);

  // KPI는 "화면에 보이는" 기준(기간·동작필터·검색 반영).
  const officeCount = shown.filter((r) => r.net === "office").length;
  const outsideCount = shown.filter((r) => r.net === "outside").length;
  const uniqueIps = new Set(shown.filter((r) => r.ip !== "—").map((r) => r.ip)).size;

  const kpis = [
    { label: "전체 접속", value: shown.length, unit: "건", color: "var(--text)" },
    { label: "사내망", value: officeCount, unit: "건", color: "var(--success)" },
    { label: "외부 접속", value: outsideCount, unit: "건", color: outsideCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "접속 IP 종류", value: uniqueIps, unit: "개", color: "var(--text)" },
  ];

  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q);
  if (kindKey !== "all") params.set("kind", kindKey);
  const exportHref = params.toString() ? `${exportBase}&${params.toString()}` : exportBase;

  return (
    <div>
      {/* 상단: 기간 달력 + 검색(왼쪽) / 엑셀(오른쪽) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <RangeCalendarNav from={from} to={to} todayISO={todayISO} basePath="/security/access" />
          <div style={{ minWidth: 220, flex: "0 1 300px" }}>
            <SearchBox value={q} onChange={setQ} placeholder="이름·IP·기기·사내망 검색" />
          </div>
        </div>
        <a
          href={exportHref}
          style={{ height: 40, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
        >
          ⬇ 엑셀 내보내기
        </a>
      </div>

      {/* 동작 필터 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {KIND_FILTERS.map((f) => {
          const on = f.key === kindKey;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setKindKey(f.key)}
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: on ? "var(--primary)" : "#fff",
                color: on ? "#fff" : "var(--text-sub)",
                border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* KPI 4개 */}
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 8, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}<span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 안내 */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        로그인·출퇴근 등 모든 접속을 IP·기기 기준으로 봅니다. <b>IP는 실제 운영 서버(외부 접속)에서만 정확</b>하며, 개발 환경에서는 내부 주소로 보일 수 있습니다.
        {!hasIpRule && (
          <> · <b style={{ color: "var(--warning)" }}>회사 허용 IP가 등록되지 않아 사내망/외부를 판정할 수 없습니다</b> — [설정 → 사내 네트워크]에서 등록하세요.</>
        )}
        {capped && <> · <b style={{ color: "var(--danger)" }}>결과가 2,000건을 넘어 일부만 표시</b>됩니다. 기간을 좁혀 보세요.</>}
        <br />
        접속 경로(사내망/외부)는 <b>지금 등록된 회사 허용 IP를 기준으로 그때그때 판정</b>합니다 — 허용 IP를 바꾸면 과거 기록의 표시도 함께 바뀝니다.
        해외·국가 표시는 GeoIP 연동 후 추가될 예정입니다.
        <br />
        접속기록 <b>보관기간은 법정 기준 확인 후 확정</b>될 예정입니다(현재는 자동 파기하지 않고 모두 보관).
      </div>

      {/* 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>시각</th>
                <th style={th}>이름</th>
                <th style={th}>동작</th>
                <th style={th}>기기</th>
                <th style={th}>IP</th>
                <th style={th}>접속 경로</th>
                <th style={th}>결과</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {rows.length === 0 ? "이 기간에 접속 기록이 없습니다." : "검색 결과가 없습니다."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => {
                  const n = NET_STYLE[r.net];
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
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: n.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: n.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: n.color }}>{r.netLabel}</span>
                        </span>
                      </td>
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
