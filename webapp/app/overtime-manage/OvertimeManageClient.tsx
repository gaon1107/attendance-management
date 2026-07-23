"use client";
// 초과근무 관리 표 — 주 이동 + 부서 필터 + 통합검색(즉시) + 페이징. 조회 전용(승인·정산 없음).
//  · 공통 부품 재사용: SearchBox / lib.search / TablePagination / usePagination (전부 무수정).
//  · KPI는 걸러진 목록 전체 기준, 페이징은 표 렌더만(기존 목록 화면들과 동일 규칙).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchBox } from "@/app/components/SearchBox";
import { TablePagination } from "@/app/components/TablePagination";
import { usePagination } from "@/app/components/usePagination";
import { queryTerms, matchesTerms } from "@/lib/search";
import { formatMinutes } from "@/lib/worktime";
import { EXTRA_LEVEL_LABEL, type ExtraLevel } from "@/lib/overtime-week";
import type { OvertimeLevel } from "@/lib/overtime";

export type OvertimeRow = {
  id: string;
  name: string;
  employeeNo: string | null;
  initial: string;
  dept: string; // 빈 문자열 = 부서 미배정
  isAdmin: boolean;
  left: boolean; // 퇴사자(그 주에 근무 기록이 있으면 표시)
  days: number; // 근무일수
  total: number; // 주간 실근무(분)
  base: number; // 기본근무(분, 최대 40h)
  extra: number; // 연장근로(분)
  ratioPercent: number; // 주 12h 한도 대비 %
  level: ExtraLevel;
  weekLevel: OvertimeLevel; // 주 52h 기준(대시보드 알림과 동일)
  search: string;
};

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "13px 20px", fontSize: 15, verticalAlign: "middle" };

const LEVEL_COLOR: Record<ExtraLevel, { bg: string; fg: string }> = {
  none: { bg: "#F3F4F6", fg: "#6B7280" },
  ok: { bg: "#DCFCE7", fg: "#15803D" },
  near: { bg: "#FEF3C7", fg: "#B45309" },
  over: { bg: "#FEE2E2", fg: "#B91C1C" },
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

export function OvertimeManageClient({
  rows,
  depts,
  warnHours,
  weekLabelText,
  prevWeek,
  nextWeek,
  thisWeek,
  isThisWeek,
  isFutureBlocked,
  dailyExtraOver,
  standardHours,
}: {
  rows: OvertimeRow[];
  depts: string[];
  warnHours: number;
  weekLabelText: string;
  prevWeek: string;
  nextWeek: string;
  thisWeek: string;
  isThisWeek: boolean;
  isFutureBlocked: boolean; // 이번 주면 "다음 주"(미래) 이동 막기
  dailyExtraOver: string[]; // 주 40시간 기준으론 한도 미만이나, 하루 기준으론 연장 12시간을 넘는 직원
  standardHours: number; // 회사 기준 일 근무시간(하루 기준 연장 계산용)
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");

  const filtered = useMemo(() => {
    const terms = queryTerms(q);
    return rows
      .filter((r) => (dept === "all" ? true : dept === "none" ? !r.dept : r.dept === dept))
      .filter((r) => matchesTerms(r.search, terms));
  }, [q, dept, rows]);

  const pg = usePagination(filtered, { initialSize: 100, resetKey: `${q}|${dept}|${weekLabelText}` });

  // KPI — 걸러진 목록 전체 기준
  const totalExtra = filtered.reduce((s, r) => s + r.extra, 0);
  const withExtra = filtered.filter((r) => r.extra > 0).length;
  const overLimit = filtered.filter((r) => r.level === "over").length;
  const over52 = filtered.filter((r) => r.weekLevel === "over").length;

  const kpis = [
    { label: "집계 인원", value: `${filtered.length}`, unit: "명" },
    { label: "연장근로 발생", value: `${withExtra}`, unit: "명" },
    { label: "총 연장근로", value: totalExtra > 0 ? formatMinutes(totalExtra) : "0분", unit: "" },
    { label: "주 12시간 한도 초과", value: `${overLimit}`, unit: "명" },
  ];

  return (
    <>
      {/* 주 이동 + 필터 + 검색 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => router.push(`/overtime-manage?week=${prevWeek}`)} style={navBtn(false)}>
          ◀ 이전 주
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, padding: "0 6px", whiteSpace: "nowrap" }}>{weekLabelText}</div>
        <button
          type="button"
          disabled={isFutureBlocked}
          onClick={() => !isFutureBlocked && router.push(`/overtime-manage?week=${nextWeek}`)}
          style={navBtn(isFutureBlocked)}
        >
          다음 주 ▶
        </button>
        {!isThisWeek && (
          <button type="button" onClick={() => router.push(`/overtime-manage?week=${thisWeek}`)} style={navBtn(false)}>
            이번 주
          </button>
        )}

        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          style={{ height: 38, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "inherit", fontSize: 14, background: "#fff" }}
        >
          <option value="all">전체 부서</option>
          {depts.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
          <option value="none">부서 미배정</option>
        </select>
        <SearchBox value={q} onChange={setQ} />
      </div>

      {/* 계산 기준 안내 — 이 표는 "주 40시간 초과"만 센다. 법정 연장은 "일 8시간 초과"도 포함이라 반드시 함께 알린다. */}
      <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.7, marginBottom: 16, wordBreak: "keep-all" }}>
        📏 <b>이 표의 계산 기준</b>: 한 주(월~일) 실근무 중 <b>40시간까지가 기본근무</b>, 넘는 시간이 <b>연장근로</b>입니다. 연장근로 법정 한도는 <b>주 12시간</b>(40+12=52시간)입니다.
        <br />
        ⚠️ 법에서 말하는 연장근로는 <b>주 40시간 초과</b>와 <b>하루 {standardHours}시간 초과</b>를 모두 포함합니다. <b>이 표는 주 기준만</b> 셉니다 — 며칠에 몰아서 일한 경우(예: 3일간 12시간씩)는 주 40시간에 못 미쳐 이 표에 <b>연장 0으로 보일 수 있습니다</b>. 하루 기준 초과분은 [리포트] 화면의 &quot;초과근무&quot; 열에서 확인하세요.
        <br />
        ※ 주 52시간 판정(근접 {warnHours}시간)은 대시보드 알림과 같은 계산이지만, 이 표는 <b>관리자·퇴사자도 포함</b>해 집계하므로 인원수가 다를 수 있습니다.
        <br />
        ※ 근무는 <b>출근한 날</b>을 기준으로 그 주에 넣습니다(자정을 넘긴 근무도 출근일 기준).
      </div>

      {dailyExtraOver.length > 0 && (
        <div style={{ background: "#FEF3C7", color: "#B45309", fontSize: 14, fontWeight: 700, padding: "12px 16px", borderRadius: 10, marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
          ⚠️ <b>하루 {standardHours}시간 초과분</b>으로 계산하면 연장 12시간을 넘는 직원이 있습니다: {dailyExtraOver.join(", ")}
          <br />
          <span style={{ fontWeight: 400 }}>주 40시간에는 못 미쳐 아래 표에는 &quot;연장 없음/정상&quot;으로 보이지만, 법정 한도 관리 대상입니다.</span>
        </div>
      )}

      {/* KPI */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 700, marginBottom: 10, whiteSpace: "nowrap" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap" }}>
              {k.value}
              {k.unit && <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-sub)", marginLeft: 2 }}>{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {over52 > 0 && (
        <div style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 14, fontWeight: 700, padding: "12px 16px", borderRadius: 10, marginBottom: 16, lineHeight: 1.6, wordBreak: "keep-all" }}>
          ⚠️ 이 주에 <b>주 52시간을 넘긴 직원 {over52}명</b>이 있습니다. 근로시간 조정이 필요합니다.
        </div>
      )}

      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>부서</th>
                <th style={{ ...th, textAlign: "right" }}>근무일수</th>
                <th style={{ ...th, textAlign: "right" }}>주간 실근무</th>
                <th style={{ ...th, textAlign: "right" }}>기본근무</th>
                <th style={{ ...th, textAlign: "right" }}>연장근로</th>
                <th style={{ ...th, textAlign: "right" }}>한도(주 12h) 대비</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {pg.view.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() || dept !== "all" ? "검색 결과가 없습니다." : "이 주에는 출퇴근 기록이 없습니다."}
                  </td>
                </tr>
              ) : (
                pg.view.map((r) => {
                  const c = LEVEL_COLOR[r.level];
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
                            {r.left && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}> (퇴사)</span>}
                          </span>
                        </div>
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{r.dept || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.days}일</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                        {formatMinutes(r.total)}
                        {r.weekLevel === "over" && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>주 52시간 초과</div>}
                        {r.weekLevel === "warn" && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning)" }}>52시간 근접</div>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-sub)" }}>{formatMinutes(r.base)}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: r.extra > 0 ? "var(--text)" : "var(--text-sub)" }}>
                        {r.extra > 0 ? formatMinutes(r.extra) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.extra > 0 ? `${r.ratioPercent}%` : "—"}</td>
                      <td style={td}>
                        <span style={{ fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>
                          {EXTRA_LEVEL_LABEL[r.level]}
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
