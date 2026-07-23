"use client";
// 휴게 준수 현황 표 — 날짜 이동 + 통합검색(즉시) + 페이징. 조회 전용.
//  · 공통 부품 재사용(SearchBox / lib.search / TablePagination / usePagination) — 전부 무수정.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchBox } from "@/app/components/SearchBox";
import { TablePagination } from "@/app/components/TablePagination";
import { usePagination } from "@/app/components/usePagination";
import { queryTerms, matchesTerms } from "@/lib/search";
import { formatMinutes } from "@/lib/worktime";
import { BREAK_STATUS_LABEL, type BreakStatus } from "@/lib/break-rule";

export type BreakRow = {
  id: string;
  name: string;
  employeeNo: string | null;
  initial: string;
  dept: string;
  isAdmin: boolean;
  worked: number; // 그날 실근무(분)
  actual: number; // 그날 휴게(분) = 외출 합계
  required: number; // 필요한 최소 휴게(분)
  shortage: number; // 부족분(분)
  status: BreakStatus;
  working: boolean; // 아직 퇴근 전
  search: string;
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "13px 20px", fontSize: 15, verticalAlign: "middle" };

const STATUS_COLOR: Record<BreakStatus, { bg: string; fg: string }> = {
  none: { bg: "#F3F4F6", fg: "#6B7280" },
  ok: { bg: "#DCFCE7", fg: "#15803D" },
  short: { bg: "#FEE2E2", fg: "#B91C1C" },
};

const navBtn = (disabled: boolean): React.CSSProperties => ({
  height: 38,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "#fff",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 700,
  color: disabled ? "var(--text-sub)" : "var(--text)",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
  whiteSpace: "nowrap",
});

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function BreakStatusClient({
  rows,
  dateISO,
  todayISO,
  checkOn,
  rule,
}: {
  rows: BreakRow[];
  dateISO: string;
  todayISO: string;
  checkOn: boolean;
  rule: { min4h: number; min8h: number };
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const terms = queryTerms(q);
    return rows.filter((r) => matchesTerms(r.search, terms));
  }, [q, rows]);
  const pg = usePagination(filtered, { initialSize: 100, resetKey: `${q}|${dateISO}` });

  const shortCount = filtered.filter((r) => r.status === "short").length;
  const shortDone = filtered.filter((r) => r.status === "short" && !r.working).length; // 퇴근까지 한 사람 = 확정 부족
  const isToday = dateISO === todayISO;
  const isFutureBlocked = dateISO >= todayISO;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => router.push(`/break-time?date=${shiftDate(dateISO, -1)}`)} style={navBtn(false)}>
          ◀ 이전 날
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, padding: "0 6px", whiteSpace: "nowrap" }}>
          {dateISO}
          {isToday && <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 400 }}> (오늘)</span>}
        </div>
        <button
          type="button"
          disabled={isFutureBlocked}
          onClick={() => !isFutureBlocked && router.push(`/break-time?date=${shiftDate(dateISO, 1)}`)}
          style={navBtn(isFutureBlocked)}
        >
          다음 날 ▶
        </button>
        {!isToday && (
          <button type="button" onClick={() => router.push(`/break-time?date=${todayISO}`)} style={navBtn(false)}>
            오늘
          </button>
        )}
        <SearchBox value={q} onChange={setQ} />
      </div>

      <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7, marginBottom: 16, wordBreak: "keep-all" }}>
        📏 <b>판정 기준</b>: 근무 4시간 초과 → 최소 {rule.min4h}분, 8시간 초과 → 최소 {rule.min8h}분. 휴게시간은 <b>직원의 [외출]~[복귀] 합계</b>입니다.
        <br />
        ※ 이 화면은 <b>점검·표시 전용</b>입니다. 근무시간에서 휴게를 자동으로 빼지 않으므로 리포트·법정기록 숫자는 달라지지 않습니다.
        {!checkOn && (
          <>
            <br />
            <b style={{ color: "var(--warning)" }}>⚠️ 준수 점검이 꺼져 있습니다</b> — 부족 표시를 하지 않습니다(위 설정에서 켤 수 있습니다).
          </>
        )}
      </div>

      {checkOn && shortCount > 0 && (
        <div style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 14, fontWeight: 700, padding: "12px 16px", borderRadius: 10, marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
          ⚠️ 휴게시간이 부족한 직원 <b>{shortCount}명</b>
          {shortDone !== shortCount && <>(이 중 퇴근 완료 {shortDone}명 — 근무 중인 직원은 아직 쉴 시간이 남아 있습니다)</>}
        </div>
      )}

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>부서</th>
                <th style={{ ...th, textAlign: "right" }}>근무</th>
                <th style={{ ...th, textAlign: "right" }}>휴게</th>
                <th style={{ ...th, textAlign: "right" }}>필요 휴게</th>
                <th style={{ ...th, textAlign: "right" }}>부족</th>
                <th style={th}>판정</th>
              </tr>
            </thead>
            <tbody>
              {pg.view.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "이 날에는 출퇴근 기록이 없습니다."}
                  </td>
                </tr>
              ) : (
                pg.view.map((r) => {
                  // 점검을 끄면 부족을 강조하지 않는다(회사 판단으로 점검 미사용).
                  const shown: BreakStatus = checkOn ? r.status : "none";
                  const c = STATUS_COLOR[shown];
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                            {r.initial}
                          </div>
                          <span style={{ fontWeight: 700 }}>
                            {r.name}
                            {r.employeeNo && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}> · {r.employeeNo}</span>}
                            {r.isAdmin && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}> (관리자)</span>}
                            {r.working && <span style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700 }}> · 근무 중</span>}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{r.dept || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{formatMinutes(r.worked)}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.actual > 0 ? formatMinutes(r.actual) : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-sub)" }}>{r.required > 0 ? `${r.required}분` : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: checkOn && r.shortage > 0 ? "var(--danger)" : "var(--text-sub)" }}>
                        {checkOn && r.shortage > 0 ? `${r.shortage}분` : "—"}
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>
                          {BREAK_STATUS_LABEL[shown]}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <TablePagination pg={pg} />
      </section>
    </>
  );
}
