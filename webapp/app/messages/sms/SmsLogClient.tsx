"use client";
// 문자 발송 기록(관리자) — 공통 기간 달력 + 통합검색 + 요약 + 표.
//  · 데이터·회사격리·권한·기간조회는 서버(page.tsx)가 책임진다. 여기선 필터·표시만 한다.
//  · 공통 컴포넌트를 쓴다(디자인 규칙 §5.6): 기간=RangeCalendarNav, 검색=SearchBox.
import { useMemo, useState } from "react";
import { RangeCalendarNav } from "@/app/components/RangeCalendarNav";
import { SearchBox } from "@/app/components/SearchBox";
import { TablePagination } from "@/app/components/TablePagination";
import { usePagination } from "@/app/components/usePagination";
import { queryTerms, matchesTerms } from "@/lib/search";
import { SMS_RESULT_STYLE } from "@/lib/sms-labels";

export type SmsRow = {
  id: string;
  timeText: string;
  name: string;
  employeeNo: string | null;
  phone: string;
  kindLabel: string;
  result: string; // success | fail | pending | unknown
  resultLabel: string;
  viaCompany: boolean;
  payerLabel: string;
  detail: string;
  search: string;
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 16px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 16px", fontSize: 14, verticalAlign: "middle", whiteSpace: "nowrap" };

export function SmsLogClient({
  rows,
  from,
  to,
  todayISO,
  capped,
}: {
  rows: SmsRow[];
  from: string;
  to: string;
  todayISO: string;
  capped: boolean;
}) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const terms = queryTerms(q);
    if (!terms.length) return rows;
    return rows.filter((r) => matchesTerms(r.search, terms));
  }, [rows, q]);

  const pg = usePagination(shown, { initialSize: 100, resetKey: `${q}|${from}|${to}` });

  // 요약은 "화면에 보이는" 기준(검색 반영).
  const okCount = shown.filter((r) => r.result === "success").length;
  const failCount = shown.filter((r) => r.result === "fail").length;
  // 보내는 중 + 결과 미확인 — 둘 다 "아직 결과를 모른다". 미확인은 요금이 나갔을 수도 있다.
  const waitCount = shown.filter((r) => r.result === "pending" || r.result === "unknown").length;
  // 우리 회사 계정으로 **실제로 나간** 것 = 회사 요금이 드는 문자(가온 계정 인증 문자는 제외).
  //  🟡 [2026-11-22 검수 중간 2] 실패는 빼야 한다 — 발송 자체가 안 됐으므로 요금이 없다
  //     (app/actions/sms.ts "실패 = 과금 없음"). 넣으면 요금 숫자가 실제보다 많아 보인다.
  //     "결과 미확인"은 뺄 수 없다 — 나갔을 수도 있어 요금이 붙었을 수 있다.
  const companyCount = shown.filter((r) => r.viaCompany && r.result !== "fail").length;

  // 🟡 [2026-11-22 검수 중간 3] 2,000건 상한에 걸리면 이 숫자는 **최근 2,000건만** 센 값이다.
  //    그대로 두면 관리자가 "이번 달 실패 3건"으로 잘못 읽는다 → 제목에 기준을 밝힌다.
  const capNote = capped ? " (최근 2,000건)" : "";
  const kpis = [
    { label: `발송 성공${capNote}`, value: okCount, color: "var(--text)" },
    { label: `실패${capNote}`, value: failCount, color: failCount > 0 ? "var(--danger)" : "var(--text)" },
    { label: `보내는 중·결과 미확인${capNote}`, value: waitCount, color: waitCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: `우리 회사 계정 발송${capNote}`, value: companyCount, color: "var(--text)" },
  ];

  return (
    <div>
      {/* 상단: 기간 달력 + 검색(왼쪽 정렬 — 디자인 규칙 §5.6③) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <RangeCalendarNav from={from} to={to} todayISO={todayISO} basePath="/messages/sms" />
        <div style={{ minWidth: 220, flex: "0 1 320px" }}>
          <SearchBox value={q} onChange={setQ} placeholder="이름·번호·종류·결과 검색" />
        </div>
      </div>

      {/* 요약 4개 */}
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 8, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>건</span>
            </div>
          </div>
        ))}
      </div>

      {/* 안내 — 요금 규칙을 여기서 한 번 설명한다(2026-11-21 사장님 확정). */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
        우리 회사에서 나간 문자 기록입니다. <b>요금</b> 칸이 &quot;우리 회사&quot;인 것만 회사가 연결한 비즈모아샷 계정에서 요금이 나갑니다
        (&quot;가온&quot;은 회사 계정 본인 확인 문자라 가온이 부담합니다). <b>결과 미확인</b>은 실패가 아니라 보냈는지 확인되지 않은 상태로,
        요금이 나갔을 수도 있습니다. <b>실패</b>한 문자는 나가지 않았으므로 요금도 들지 않습니다.
        {capped && (
          <>
            {" "}
            · <b style={{ color: "var(--danger)" }}>결과가 2,000건을 넘어 최근 2,000건만 표시</b>됩니다. 위 요약도 그만큼만 센
            숫자이니 기간을 좁혀 보세요.
          </>
        )}
      </div>

      {/* 표 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>보낸 시각</th>
                <th style={th}>받는 사람</th>
                <th style={th}>번호</th>
                <th style={th}>종류</th>
                <th style={th}>결과</th>
                <th style={th}>요금</th>
                <th style={th}>비고</th>
              </tr>
            </thead>
            <tbody>
              {pg.view.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "28px 16px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {rows.length === 0 ? "이 기간에 보낸 문자가 없습니다." : "검색 결과가 없습니다."}
                  </td>
                </tr>
              ) : (
                pg.view.map((r) => {
                  const s = SMS_RESULT_STYLE[r.result] ?? SMS_RESULT_STYLE.pending;
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: "var(--text-sub)" }}>{r.timeText}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        {r.employeeNo && <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{r.employeeNo}</div>}
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.phone}</td>
                      <td style={td}>{r.kindLabel}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: s.bg }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{r.resultLabel}</span>
                        </span>
                      </td>
                      {/* 실패한 문자는 나가지 않아 요금이 없다 — 어느 계정이었는지보다 "요금 없음"이 중요하다(검수 중간 2). */}
                      <td style={{ ...td, color: r.result === "fail" ? "var(--text-sub)" : r.viaCompany ? "var(--text)" : "var(--text-sub)", fontWeight: r.result !== "fail" && r.viaCompany ? 700 : 400 }}>
                        {r.result === "fail" ? "—" : r.payerLabel}
                      </td>
                      {/* 비고(실패 사유 등)는 길 수 있어 한 줄로 자른다 — 전체는 마우스를 올리면 보인다. */}
                      <td style={{ ...td, color: "var(--text-sub)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={r.detail}>
                        {r.detail || "—"}
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
    </div>
  );
}
