"use client";
// 휴가 승인 목록 (클라이언트) — 공통 기간 달력 + 통합검색.
//  · 기간(RangeCalendar): "처리 내역"을 휴가 기간이 걸치는 것으로 서버에서 좁힌다(대기는 항상 전체).
//  · 검색(SearchBox): 대기·처리내역 두 목록을 신청자·종류·사유·상태로 즉시 필터.
import { useMemo, useState } from "react";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";
import { approveLeave, rejectLeave } from "@/app/actions/leave";

export type LeaveRow = {
  id: string;
  name: string;
  initial: string;
  typeLabel: string;
  rangeLabel: string;
  days: number;
  reason: string;
  status: string;
  statusLabel: string;
  search: string;
};

const STATUS_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  approved: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  rejected: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "13px 20px", fontSize: 15, verticalAlign: "middle" };

function NameCell({ name, initial }: { name: string; initial: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
        {initial}
      </div>
      <span style={{ fontWeight: 700 }}>{name}</span>
    </div>
  );
}

export function LeaveApprovalsClient({
  pending,
  decided,
  from,
  to,
  todayISO,
}: {
  pending: LeaveRow[];
  decided: LeaveRow[];
  from: string;
  to: string;
  todayISO: string;
}) {
  const [q, setQ] = useState("");
  const p = useMemo(() => { const t = queryTerms(q); return pending.filter((r) => matchesTerms(r.search, t)); }, [q, pending]);
  const d = useMemo(() => { const t = queryTerms(q); return decided.filter((r) => matchesTerms(r.search, t)); }, [q, decided]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <RangeCalendarNav from={from} to={to} todayISO={todayISO} basePath="/leave/approvals" />
        <SearchBox value={q} onChange={setQ} placeholder="신청자·종류·사유 검색" />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 16 }}>
        기간은 <b>처리 내역</b>에 적용됩니다(처리한 시점 기준). 승인 대기는 항상 전체를 보여줍니다.
      </div>

      {/* 승인 대기 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 16, fontWeight: 700 }}>
          승인 대기 {p.length > 0 && <span style={{ color: "var(--warning)" }}>{p.length}건</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>종류</th>
                <th style={th}>기간</th>
                <th style={{ ...th, textAlign: "right" }}>일수</th>
                <th style={th}>사유</th>
                <th style={{ ...th, textAlign: "right" }}>처리</th>
              </tr>
            </thead>
            <tbody>
              {p.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "승인 대기 중인 휴가 신청이 없습니다."}
                  </td>
                </tr>
              ) : (
                p.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}><NameCell name={r.name} initial={r.initial} /></td>
                    <td style={{ ...td, fontWeight: 700 }}>{r.typeLabel}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.rangeLabel}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.days}일</td>
                    <td style={{ ...td, color: "var(--text-sub)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 8 }}>
                        <form action={approveLeave}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" style={{ height: 34, padding: "0 14px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>승인</button>
                        </form>
                        <form action={rejectLeave}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" style={{ height: 34, padding: "0 14px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>반려</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 처리 내역 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 16, fontWeight: 700, color: "var(--text-sub)" }}>처리 내역</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>종류</th>
                <th style={th}>기간</th>
                <th style={{ ...th, textAlign: "right" }}>일수</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {d.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "24px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "이 기간에 처리한 휴가가 없습니다."}
                  </td>
                </tr>
              ) : (
                d.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.approved;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={td}><NameCell name={r.name} initial={r.initial} /></td>
                      <td style={{ ...td, fontWeight: 700 }}>{r.typeLabel}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.rangeLabel}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.days}일</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{r.statusLabel}</span>
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
    </>
  );
}
