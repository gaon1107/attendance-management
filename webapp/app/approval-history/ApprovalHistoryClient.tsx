"use client";
// 결재 이력 (클라이언트) — 필터바(유형·상태·기간 서버나비) + 통합검색(SearchBox, 즉시필터) + 결과 표.
//  · 유형·상태·기간은 URL(router.push)로 서버 재조회. 검색은 로드된 행을 신청자·내용·사유·처리자로 즉시 OR 필터.
//  · 직원 드롭다운(수백 명 회사에서 비현실적)을 통합검색으로 대체(공통 SearchBox/lib/search).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RangeCalendar } from "@/app/components/RangeCalendar";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";
import type { RequestType } from "@/lib/approval-server";

export type HistoryClientRow = {
  key: string;
  type: RequestType;
  createdAtText: string;
  applicantName: string;
  applicantNo: string | null;
  applicantDept: string | null;
  summary: string;
  reason: string | null;
  status: string;
  decidedByName: string | null;
  decidedAtText: string | null;
  decisionComment: string | null;
  search: string; // 소문자 결합(신청자·사번·부서·유형·내용·사유·상태·처리자) — 통합검색 대상
};

const TYPE_LABEL: Record<RequestType, string> = { leave: "휴가", correction: "근태정정", outing: "외출/외근", remote: "재택근무", overtime: "초과근무", trip: "출장" };
const TYPE_BADGE: Record<RequestType, { bg: string; color: string }> = {
  leave: { bg: "#E4EDFF", color: "#2563EB" },
  correction: { bg: "#FEF3C7", color: "#B45309" },
  outing: { bg: "#DCFCE7", color: "#15803D" },
  remote: { bg: "#EDE9FE", color: "#7C3AED" },
  overtime: { bg: "#FFE4E6", color: "#BE123C" },
  trip: { bg: "#E0F2FE", color: "#0369A1" },
};
const STATUS_LABEL: Record<string, string> = { pending: "대기", approved: "승인", rejected: "반려" };
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  pending: { bg: "#FEF3C7", color: "#B45309" },
  approved: { bg: "#DCFCE7", color: "#15803D" },
  rejected: { bg: "#FEE2E2", color: "#B91C1C" },
};

const TYPE_OPTS: { value: string; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "leave", label: "휴가" },
  { value: "correction", label: "근태정정" },
  { value: "outing", label: "외출/외근" },
  { value: "remote", label: "재택근무" },
  { value: "overtime", label: "초과근무" },
  { value: "trip", label: "출장" },
];

const selectStyle: React.CSSProperties = { height: 38, padding: "0 10px", border: "1px solid #D1D5DB", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: "#fff", color: "var(--text)" };
const capStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--text-sub)" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 14px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 14px", fontSize: 14, verticalAlign: "top" };

function badge(bg: string, color: string, text: string): React.ReactElement {
  return <span style={{ display: "inline-block", fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: bg, color, whiteSpace: "nowrap" }}>{text}</span>;
}

export function ApprovalHistoryClient({
  rows,
  type,
  status,
  from,
  to,
  todayISO,
  limitReached,
  historyLimit,
}: {
  rows: HistoryClientRow[];
  type: string;
  status: string;
  from: string;
  to: string;
  todayISO: string;
  limitReached: boolean;
  historyLimit: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  // 통합검색: 로드된 행을 신청자·내용·사유·처리자 등으로 즉시 OR 필터(URL 변경 없음).
  const shown = useMemo(() => {
    const terms = queryTerms(q);
    return rows.filter((r) => matchesTerms(r.search, terms));
  }, [q, rows]);

  // 유형·상태·기간은 URL 파라미터로 서버 재조회. 현재 값에 변경분만 덮어 URL 생성(기본값=생략).
  const build = (over: Partial<{ type: string; status: string; from: string; to: string }>) => {
    const v = { type, status, from, to, ...over };
    const p = new URLSearchParams();
    if (v.type !== "all") p.set("type", v.type);
    if (v.status !== "all") p.set("status", v.status);
    if (v.from) p.set("from", v.from);
    if (v.to) p.set("to", v.to);
    const qs = p.toString();
    return `/approval-history${qs ? `?${qs}` : ""}`;
  };

  const searching = q.trim().length > 0;

  return (
    <>
      {/* 필터 바 — 유형·상태 select(제어형, 뒤로가기 표시 일치) + 공통 기간 달력 + 통합검색 */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
          유형
          <select value={type} onChange={(e) => router.push(build({ type: e.target.value }))} style={selectStyle}>
            {TYPE_OPTS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
          상태
          <select value={status} onChange={(e) => router.push(build({ status: e.target.value }))} style={selectStyle}>
            <option value="all">전체</option>
            <option value="pending">대기</option>
            <option value="approved">승인</option>
            <option value="rejected">반려</option>
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
          신청 기간
          <RangeCalendar from={from} to={to} todayISO={todayISO} onApply={(f, t) => router.push(build({ from: f, to: t }))} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
          통합검색
          <SearchBox value={q} onChange={setQ} placeholder="신청자·사번·부서·내용·사유·처리자" width={260} />
        </label>

        <a href="/approval-history" style={{ height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>초기화</a>
      </div>

      {/* 결과 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>
            조회 결과 {shown.length}건
            {searching ? ` · 불러온 ${rows.length}건에서 검색` : ""}
            {/* 상한 도달 시 검색 여부와 무관하게 항상 경고 — 검색은 불러온 범위에서만 되므로 조용한 누락 방지(감사 신뢰성). */}
            {limitReached && (
              <span style={{ color: "var(--danger)" }}>
                {" · "}⚠️ 표시 상한 {historyLimit}건 도달 — {searching ? "검색은 불러온 범위에서만 됩니다. " : ""}기간을 좁혀 조회하세요
              </span>
            )}
          </span>
          {/* 지금 무슨 기간을 보고 있는지 항상 표기 — 기본 '이번 달'이 과거 이력을 조용히 가리지 않도록. */}
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
            조회 기간(신청일 기준): {from} ~ {to}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청일시</th>
                <th style={th}>유형</th>
                <th style={th}>신청자</th>
                <th style={th}>내용</th>
                <th style={th}>상태</th>
                <th style={th}>처리자</th>
                <th style={th}>처리일시</th>
                <th style={th}>결재 의견</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "32px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {searching ? "검색 결과가 없습니다." : "조회된 결재 이력이 없습니다."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.key} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, color: "var(--text-sub)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.createdAtText}</td>
                    <td style={td}>{badge(TYPE_BADGE[r.type].bg, TYPE_BADGE[r.type].color, TYPE_LABEL[r.type])}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 700 }}>{r.applicantName}</span>
                      {r.applicantNo && <span style={{ fontSize: 12, color: "var(--text-sub)", marginLeft: 6 }}>{r.applicantNo}</span>}
                      {r.applicantDept && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.applicantDept}</div>}
                    </td>
                    <td style={{ ...td, minWidth: 200 }}>
                      <div>{r.summary}</div>
                      {r.reason && <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>사유: {r.reason}</div>}
                    </td>
                    <td style={td}>{badge(STATUS_STYLE[r.status]?.bg ?? "#EEE", STATUS_STYLE[r.status]?.color ?? "#555", STATUS_LABEL[r.status] ?? r.status)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: r.decidedByName ? "var(--text)" : "var(--text-sub)" }}>{r.decidedByName ?? "—"}</td>
                    <td style={{ ...td, color: "var(--text-sub)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.decidedAtText ?? "—"}</td>
                    <td style={{ ...td, minWidth: 160, color: r.status === "rejected" ? "var(--danger)" : "var(--text-sub)" }}>
                      {r.decisionComment ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.decisionComment}</span> : "—"}
                    </td>
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
