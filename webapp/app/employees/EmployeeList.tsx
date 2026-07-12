"use client";
// 직원 목록(재직/퇴사) + 통합검색 — 이름·이메일·부서로 즉시 필터. (직원 관리 화면)
import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";

export type EmpRow = { id: string; name: string; initial: string; dept: string; deptSet: boolean; email: string; authLabel: string; hasAuth: boolean; consented: boolean; joinLabel: string; search: string };
export type RetiredRow = { id: string; name: string; initial: string; email: string; retireLabel: string; search: string };

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px" };
const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle" };

export function EmployeeList({ active, retired }: { active: EmpRow[]; retired: RetiredRow[] }) {
  const [q, setQ] = useState("");
  const a = useMemo(() => { const t = queryTerms(q); return active.filter((r) => matchesTerms(r.search, t)); }, [q, active]);
  const r = useMemo(() => { const t = queryTerms(q); return retired.filter((x) => matchesTerms(x.search, t)); }, [q, retired]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder="이름·이메일·부서 검색" />
      </div>

      {/* 재직 직원 */}
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>부서</th>
                <th style={th}>이메일</th>
                <th style={th}>인증방식</th>
                <th style={th}>생체동의</th>
                <th style={th}>가입일</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {a.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "아직 등록된 직원이 없습니다. 위에서 첫 직원을 추가해보세요."}
                  </td>
                </tr>
              ) : (
                a.map((emp) => (
                  <tr key={emp.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      <Link href={`/employees/${emp.id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text)" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>{emp.initial}</div>
                        <span style={{ fontWeight: 700 }}>{emp.name}</span>
                      </Link>
                    </td>
                    <td style={{ ...td, color: emp.deptSet ? "var(--text)" : "#9CA3AF" }}>{emp.dept}</td>
                    <td style={{ ...td, color: "var(--text-sub)" }}>{emp.email}</td>
                    <td style={{ ...td, color: emp.hasAuth ? "var(--text)" : "#9CA3AF" }}>{emp.authLabel}</td>
                    <td style={{ ...td, color: emp.consented ? "#15803D" : "#9CA3AF" }}>{emp.consented ? "동의함" : "—"}</td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{emp.joinLabel}</td>
                    <td style={td}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#F3F4F6" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>재직중</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 퇴사한 직원 */}
      {retired.length > 0 && (
        <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginTop: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700, color: "var(--text-sub)" }}>
            퇴사한 직원 {retired.length}명 <span style={{ fontWeight: 400 }}>(과거 근태 기록은 리포트에 보존됩니다)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                  <th style={th}>이름</th>
                  <th style={th}>이메일</th>
                  <th style={th}>퇴사일</th>
                  <th style={th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {r.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "24px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>검색 결과가 없습니다.</td>
                  </tr>
                ) : (
                  r.map((emp) => (
                    <tr key={emp.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={td}>
                        <Link href={`/employees/${emp.id}`} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--text-sub)" }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#9CA3AF", flexShrink: 0 }}>{emp.initial}</div>
                          <span style={{ fontWeight: 700 }}>{emp.name}</span>
                        </Link>
                      </td>
                      <td style={{ ...td, color: "var(--text-sub)" }}>{emp.email}</td>
                      <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{emp.retireLabel}</td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 6, background: "#F3F4F6" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9CA3AF" }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#6B7280" }}>퇴사</span>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
