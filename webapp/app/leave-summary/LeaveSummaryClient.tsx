"use client";
// 연차 정산(관리자) — 연도 선택 + 통합검색(이름·부서) + KPI + 엑셀 내보내기.
//  · 목록 필터만 클라이언트에서. 데이터·집계·권한·회사격리는 서버(page.tsx)가 책임진다.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";

export type LeaveSummaryRow = {
  id: string;
  name: string;
  dept: string;
  hireDate: string;
  granted: number | null; // 과거 연도는 발생 이력이 없어 null("—")
  used: number;
  remain: number | null; // granted가 null이면 함께 null
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle", whiteSpace: "nowrap" };
const num1 = (n: number) => (Math.round(n * 10) / 10).toString();
const cell = (n: number | null) => (n === null ? "—" : num1(n)); // 발생·잔여: 과거 연도는 "—"

export function LeaveSummaryClient({
  rows,
  year,
  years,
  isCurrentYear,
  exportBase,
}: {
  rows: LeaveSummaryRow[];
  year: number;
  years: number[];
  isCurrentYear: boolean;
  exportBase: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  // 통합검색(이름·부서) — 공백/쉼표 OR.
  const shown = useMemo(() => {
    const terms = queryTerms(q);
    if (!terms.length) return rows;
    return rows.filter((r) => matchesTerms(`${r.name} ${r.dept}`.toLowerCase(), terms));
  }, [rows, q]);

  // KPI는 "화면에 보이는 직원" 기준(검색 반영). 과거 연도는 발생·잔여가 "—"(사용만 의미).
  const grantedSum = shown.reduce((s, r) => s + (r.granted ?? 0), 0);
  const usedSum = shown.reduce((s, r) => s + r.used, 0);
  const totalGranted = isCurrentYear ? num1(grantedSum) : "—";
  const totalUsed = num1(usedSum);
  // 총 잔여 = 총 발생 − 총 사용(각각 독립 반올림 시 0.1 어긋나는 것 방지)
  const totalRemain = isCurrentYear ? num1(grantedSum - usedSum) : "—";

  // 엑셀: 현재 검색어를 서버에 전달해 "보이는 직원만" 내보낸다.
  const exportHref = q.trim() ? `${exportBase}&q=${encodeURIComponent(q)}` : exportBase;

  const kpis = [
    { label: "총 발생", value: totalGranted, color: "var(--text)" },
    { label: "총 사용", value: totalUsed, color: "var(--text)" },
    { label: "총 잔여", value: totalRemain, color: "var(--primary)" },
  ];

  return (
    <div>
      {/* 상단: 검색(왼쪽) + 연도 선택·엑셀(오른쪽) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ minWidth: 240, flex: "0 1 320px" }}>
          <SearchBox value={q} onChange={setQ} placeholder="이름·부서 검색 (여러 개는 띄어쓰기 = OR)" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select
            value={year}
            onChange={(e) => router.push(`/leave-summary?year=${e.target.value}`)}
            style={{ height: 40, padding: "0 12px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 15, color: "var(--text)", background: "#fff", outline: "none", cursor: "pointer" }}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <a
            href={exportHref}
            style={{ height: 40, padding: "0 16px", display: "inline-flex", alignItems: "center", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}
          >
            ⬇ 엑셀 내보내기
          </a>
        </div>
      </div>

      {/* KPI 3개 */}
      <div className="kpi-grid-3" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color }}>
              {k.value}{k.value !== "—" && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>일</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 안내: 발생일수의 의미(오해 방지) + 재직자 집계 고지 */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6 }}>
        {isCurrentYear ? (
          <>‘발생’은 각 직원의 <b>입사일 기준 자동 발생 연차</b>(관리자가 직원 상세에서 예외 조정 가능)이며, ‘사용’은 <b>{year}년에 시작한</b> 승인된 연차·반차 합계입니다.</>
        ) : (
          <><b>{year}년</b> 이력 조회 — ‘사용’은 그 해에 시작한 승인 연차·반차 합계입니다. 연도별 <b>발생 이력이 없어 발생·잔여는 표시하지 않습니다</b>(현재 설정값과 달라 오해를 부를 수 있어 생략).</>
        )}{" "}
        재직 중인 직원만 집계됩니다(연중 퇴사자의 사용분은 제외될 수 있습니다).
      </div>

      {/* 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>부서</th>
                <th style={th}>입사일</th>
                <th style={{ ...th, textAlign: "right" }}>발생</th>
                <th style={{ ...th, textAlign: "right" }}>사용</th>
                <th style={{ ...th, textAlign: "right" }}>잔여</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {rows.length === 0 ? "재직 중인 직원이 없습니다." : "검색 결과가 없습니다."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{r.dept}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.hireDate || "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{cell(r.granted)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-sub)" }}>{num1(r.used)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: r.remain !== null && r.remain < 0 ? "var(--danger)" : "var(--text)" }}>{cell(r.remain)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
