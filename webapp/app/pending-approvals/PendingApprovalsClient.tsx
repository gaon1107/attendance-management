"use client";
// 밀린 결재 현황 (클라이언트) — 유형 필터(서버 재조회) + 통합검색(즉시필터) + 오래된 순 표.
//  · 경과일 배지로 "며칠째 대기"를 강조(3일↑ 주의, 7일↑ 위험). 가장 밀린 건이 맨 위.
//  · Phase 1은 조회 전용. 대리 처리(승인/반려) 버튼은 Phase 2에서 추가.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchBox } from "@/app/components/SearchBox";
import { TablePagination } from "@/app/components/TablePagination";
import { usePagination } from "@/app/components/usePagination";
import { queryTerms, matchesTerms } from "@/lib/search";
import type { RequestType } from "@/lib/approval-server";

export type PendingClientRow = {
  key: string;
  type: RequestType;
  createdAtText: string;
  waitingDays: number;
  applicantName: string;
  applicantNo: string | null;
  applicantDept: string | null;
  summary: string;
  reason: string | null;
  // 진행상태
  stepTotal: number;
  approvedCount: number;
  nextApproverName: string | null;
  nextIsFinal: boolean;
  search: string;
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

// 경과일 배지: 오래 밀릴수록 눈에 띄게(0~2일 회색, 3~6일 주의, 7일↑ 위험).
function waitingBadge(days: number): React.ReactElement {
  const label = days === 0 ? "오늘" : `${days}일째`;
  if (days >= 7) return badge("#FEE2E2", "#B91C1C", `🔴 ${label} 대기`);
  if (days >= 3) return badge("#FEF3C7", "#B45309", `🟡 ${label} 대기`);
  return badge("#F3F4F6", "#6B7280", label);
}

// 진행상태 표시: 결재선 있으면 "n/m단계", 그리고 다음 결재자가 있으면 "· 다음: 이름", 없으면 "· 관리자 승인 대기".
//  · 결재선 없음(stepTotal=0) 또는 결재선이 있어도 다음 차례가 없는 정체 상태(드묾) 모두 "관리자 승인 대기"로 안내 —
//    관리자가 "누구 차례인지 모르는" 회색지대 없이 항상 처리 주체가 보이게 한다.
function progressText(r: PendingClientRow): React.ReactElement {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {r.stepTotal > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.approvedCount}/{r.stepTotal}단계</span>}
      {r.nextApproverName ? (
        <span style={{ color: "var(--text-sub)" }}>
          {r.stepTotal > 0 ? " · 다음: " : "다음: "}
          <span style={{ fontWeight: 700, color: "var(--text)" }}>{r.nextApproverName}</span>
          {r.nextIsFinal && <span style={{ color: "var(--primary)", fontWeight: 700 }}> (전결)</span>}
        </span>
      ) : (
        <span style={{ color: "var(--text-sub)" }}>{r.stepTotal > 0 ? " · 관리자 승인 대기" : "관리자 승인 대기"}</span>
      )}
    </span>
  );
}

export function PendingApprovalsClient({
  rows,
  type,
  limitReached,
  pendingLimit,
}: {
  rows: PendingClientRow[];
  type: string;
  limitReached: boolean;
  pendingLimit: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const terms = queryTerms(q);
    return rows.filter((r) => matchesTerms(r.search, terms));
  }, [q, rows]);
  const pg = usePagination(shown, { initialSize: 100, resetKey: `${q}|${type}` });

  const build = (over: Partial<{ type: string }>) => {
    const v = { type, ...over };
    const p = new URLSearchParams();
    if (v.type !== "all") p.set("type", v.type);
    const qs = p.toString();
    return `/pending-approvals${qs ? `?${qs}` : ""}`;
  };

  const searching = q.trim().length > 0;

  return (
    <>
      {/* 필터 바 — 유형(서버 재조회) + 통합검색(즉시필터) */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
          유형
          <select value={type} onChange={(e) => router.push(build({ type: e.target.value }))} style={selectStyle}>
            {TYPE_OPTS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, ...capStyle }}>
          통합검색
          <SearchBox value={q} onChange={setQ} placeholder="신청자·사번·부서·내용·사유·결재자" width={260} />
        </label>

        {type !== "all" && (
          <a href="/pending-approvals" style={{ height: 38, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>초기화</a>
        )}
      </div>

      {/* 결과 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>
            대기 중 {shown.length}건
            {searching ? ` · 불러온 ${rows.length}건에서 검색` : ""}
            {limitReached && (
              <span style={{ color: "var(--danger)", wordBreak: "keep-all" }}>
                {" · "}⚠️ 표시 상한 {pendingLimit}건 도달 — 유형으로 좁혀 조회하세요
              </span>
            )}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-sub)" }}>오래된 순(가장 밀린 것이 맨 위)</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>경과</th>
                <th style={th}>유형</th>
                <th style={th}>신청자</th>
                <th style={th}>내용</th>
                <th style={th}>진행 상태(지금 누구 차례)</th>
                <th style={th}>신청일시</th>
              </tr>
            </thead>
            <tbody>
              {pg.view.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "32px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {searching ? "검색 결과가 없습니다." : "대기 중인 결재가 없습니다. 👍"}
                  </td>
                </tr>
              ) : (
                pg.view.map((r) => (
                  <tr key={r.key} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{waitingBadge(r.waitingDays)}</td>
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
                    <td style={{ ...td, minWidth: 200 }}>{progressText(r)}</td>
                    <td style={{ ...td, color: "var(--text-sub)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.createdAtText}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination pg={pg} />
      </section>
    </>
  );
}
