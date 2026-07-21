"use client";
// 외출/외근 승인 목록 (클라이언트) — 공통 기간 달력 + 통합검색. (휴가 LeaveApprovalsClient 패턴)
import { useMemo, useState } from "react";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { SearchBox } from "@/app/components/SearchBox";
import { TablePagination } from "@/app/components/TablePagination";
import { usePagination } from "@/app/components/usePagination";
import { queryTerms, matchesTerms } from "@/lib/search";
import { approveOuting, rejectOuting } from "@/app/actions/outing";
import { RejectButton } from "@/app/components/RejectButton";
import { ConfirmApproveButton } from "@/app/components/ConfirmApproveButton";
import { AttachmentLinks, type AttachmentInfo } from "@/app/components/AttachmentLinks";

export type OutingRow = {
  id: string;
  name: string;
  employeeNo: string | null;
  initial: string;
  kindLabel: string;
  dateLabel: string;
  timeLabel: string;
  place: string;
  reason: string;
  status: string;
  statusLabel: string;
  progress?: string; // 부서장 결재선 진행상황(대기 건에만).
  attachments: AttachmentInfo[];
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

export function OutingApprovalsClient({
  pending,
  decided,
  from,
  to,
  todayISO,
}: {
  pending: OutingRow[];
  decided: OutingRow[];
  from: string;
  to: string;
  todayISO: string;
}) {
  const [q, setQ] = useState("");
  const p = useMemo(() => { const t = queryTerms(q); return pending.filter((r) => matchesTerms(r.search, t)); }, [q, pending]);
  const d = useMemo(() => { const t = queryTerms(q); return decided.filter((r) => matchesTerms(r.search, t)); }, [q, decided]);
  const pgP = usePagination(p, { initialSize: 100, resetKey: q });
  const pgD = usePagination(d, { initialSize: 100, resetKey: `${q}|${from}|${to}` });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <RangeCalendarNav from={from} to={to} todayISO={todayISO} basePath="/outing/approvals" />
        <SearchBox value={q} onChange={setQ} placeholder="신청자·종류·행선지·사유 검색" />
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>사번</th>
                <th style={th}>종류</th>
                <th style={th}>날짜</th>
                <th style={th}>시간</th>
                <th style={th}>행선지·사유</th>
                <th style={{ ...th, textAlign: "right" }}>처리</th>
              </tr>
            </thead>
            <tbody>
              {pgP.view.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "승인 대기 중인 외출/외근 신청이 없습니다."}
                  </td>
                </tr>
              ) : (
                pgP.view.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}><NameCell name={r.name} initial={r.initial} /></td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.employeeNo || "—"}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{r.kindLabel}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.dateLabel}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.timeLabel}</td>
                    <td style={{ ...td, color: "var(--text-sub)", maxWidth: 240 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.place ? <b style={{ color: "var(--text)" }}>{r.place}</b> : null}{r.place && r.reason ? " · " : ""}{r.reason || (r.place ? "" : "—")}
                      </div>
                      {r.progress && <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 3, fontWeight: 700 }}>{r.progress}</div>}
                      <AttachmentLinks items={r.attachments} />
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 8 }}>
                        <ConfirmApproveButton action={approveOuting} requestId={r.id} progress={r.progress} compact />
                        <RejectButton action={rejectOuting} requestId={r.id} compact />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination pg={pgP} />
      </section>

      {/* 처리 내역 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 16, fontWeight: 700, color: "var(--text-sub)" }}>처리 내역</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>신청자</th>
                <th style={th}>사번</th>
                <th style={th}>종류</th>
                <th style={th}>날짜</th>
                <th style={th}>시간</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {pgD.view.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "24px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "이 기간에 처리한 외출/외근이 없습니다."}
                  </td>
                </tr>
              ) : (
                pgD.view.map((r) => {
                  const s = STATUS_STYLE[r.status] ?? STATUS_STYLE.approved;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={td}><NameCell name={r.name} initial={r.initial} /></td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.employeeNo || "—"}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{r.kindLabel}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.dateLabel}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.timeLabel}</td>
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
        <TablePagination pg={pgD} />
      </section>
    </>
  );
}
