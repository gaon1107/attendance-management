"use client";
// 근태현황 표 + 검색 (클라이언트) — 공통 컴포넌트 조합: 기간 달력(RangeCalendar) + 통합검색(SearchBox/lib.search).
//  · 기간(from~to)은 URL로 서버 조회 → 달력 [적용] 시 router.push 로 서버가 그 기간 데이터를 다시 불러온다.
//  · 통합검색은 브라우저에서 즉시 필터(서버 왕복 없음). 여러 단어는 공백/쉼표로 구분해 OR 검색.
//  · KPI·위조배너 숫자도 걸러진 목록 기준으로 함께 갱신된다.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RangeCalendar } from "@/app/components/RangeCalendar";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";

// 서버(page.tsx)에서 미리 계산해 넘겨주는 한 줄의 표시값(직렬화 가능한 순수 객체)
export type RecordRow = {
  id: string;
  userId: string;
  userName: string;
  initial: string;
  dateText: string;
  dateISO: string;
  workMode: string;
  location: string;
  inText: string;
  outText: string;
  hasClockOut: boolean;
  holiday: boolean;
  late: boolean | null;
  early: boolean | null;
  worked: string;
  suspect: boolean;
  review: boolean;
  isWorkingNow: boolean;
  search: string; // 위 컬럼들을 합쳐 소문자로 만든 검색용 문자열
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

export function RecordsClient({
  rows,
  from,
  to,
  hasRule,
  hasEndRule,
  todayISO,
}: {
  rows: RecordRow[];
  from: string;
  to: string;
  hasRule: boolean;
  hasEndRule: boolean;
  todayISO: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  // ── 통합검색(OR) — 공통 로직(lib/search) ─────────────────────────────
  const filtered = useMemo(() => {
    const terms = queryTerms(q);
    return rows.filter((r) => matchesTerms(r.search, terms));
  }, [q, rows]);

  const total = filtered.length;
  const working = filtered.filter((r) => r.isWorkingNow).length;
  const lateCount = filtered.filter((r) => r.late === true).length;
  const earlyLeaveCount = filtered.filter((r) => r.early === true).length;
  const suspectCount = filtered.filter((r) => r.suspect).length;
  const reviewCount = filtered.filter((r) => r.review).length;

  const kpis = [
    { label: "출근 기록", value: `${total}`, unit: "건", color: "var(--text)" },
    { label: "지각", value: hasRule ? `${lateCount}` : "—", unit: hasRule ? "건" : "", color: lateCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "조퇴", value: hasEndRule ? `${earlyLeaveCount}` : "—", unit: hasEndRule ? "건" : "", color: earlyLeaveCount > 0 ? "var(--warning)" : "var(--text)" },
    { label: "근무 중", value: `${working}`, unit: "명", color: working > 0 ? "var(--success)" : "var(--text)" },
  ];

  return (
    <>
      {/* 검색바: 공통 기간달력 + 공통 통합검색(절반 폭·실시간) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <RangeCalendar from={from} to={to} todayISO={todayISO} onApply={(f, t) => router.push(`/records?from=${f}&to=${t}`)} />
        <SearchBox value={q} onChange={setQ} />
      </div>

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: k.color, whiteSpace: "nowrap" }}>
              {k.value}
              {k.unit && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {(suspectCount > 0 || reviewCount > 0) && (
        <div style={{ background: suspectCount > 0 ? "#FEE2E2" : "#FEF3C7", border: `1px solid ${suspectCount > 0 ? "#FCA5A5" : "#FCD34D"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 14, fontWeight: 700, color: suspectCount > 0 ? "#B91C1C" : "#B45309" }}>
          ⚠ {q.trim() ? "검색된 목록 중" : "이 기간에"}{suspectCount > 0 ? ` 위조 의심 ${suspectCount}건` : ""}{suspectCount > 0 && reviewCount > 0 ? "," : ""}{reviewCount > 0 ? ` 확인 필요(판독 실패) ${reviewCount}건` : ""}이 있습니다. 이름 옆 표시를 눌러 사진을 확인하세요.
        </div>
      )}

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>날짜</th>
                <th style={th}>이름</th>
                <th style={th}>근무형태</th>
                <th style={th}>위치</th>
                <th style={th}>출근</th>
                <th style={th}>퇴근</th>
                <th style={th}>지각/조퇴</th>
                <th style={{ ...th, textAlign: "right" }}>실근무</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "이 기간에 출퇴근 기록이 없습니다."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{r.dateText}</td>
                    <td style={td}>
                      <Link href={`/records/${r.userId}?date=${r.dateISO}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text)" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>
                          {r.initial}
                        </div>
                        <span style={{ fontWeight: 700 }}>{r.userName}</span>
                        {r.suspect ? (
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#B91C1C", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>⚠ 위조 의심</span>
                        ) : r.review ? (
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#D97706", borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>❓ 확인 필요</span>
                        ) : null}
                      </Link>
                    </td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{r.workMode}</td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{r.location}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.inText}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: r.hasClockOut ? "var(--text)" : "var(--text-sub)" }}>{r.outText}</td>
                    <td style={td}>
                      {r.holiday ? (
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#6D28D9" }}>휴일근무</span>
                      ) : r.late === null && r.early === null ? (
                        <span style={{ color: "#9CA3AF" }}>—</span>
                      ) : r.late || r.early ? (
                        // 지각·조퇴는 동시에 생길 수 있어 각각 알약 뱃지로 함께 표시.
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {r.late && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#FEF3C7" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>지각</span>
                            </span>
                          )}
                          {r.early && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#FFEDD5" }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C2410C" }} />
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#C2410C" }}>조퇴</span>
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#15803D" }}>정상</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: "var(--primary)", fontVariantNumeric: "tabular-nums" }}>{r.worked}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ fontSize: 13, color: "var(--text-sub)", marginTop: 12, lineHeight: 1.6 }}>
        이름을 누르면 그 직원의 날짜별 상세 기록을 볼 수 있습니다. 지각 판정은 [설정 → 근무제·기준시간]을 정해야 표시됩니다.
      </div>
    </>
  );
}
