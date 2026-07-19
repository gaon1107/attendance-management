"use client";
// 생체정보(동의 현황) 목록 + 통합검색 — 이름·인증방식·동의여부로 즉시 필터. 파기 서버액션 유지.
import { useMemo, useState } from "react";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";
import { adminRevokeBiometric } from "@/app/actions/authmethod";

export type BioRow = { id: string; name: string; employeeNo: string | null; initial: string; isAdmin: boolean; authLabel: string; hasAuth: boolean; consented: boolean; consentDateLabel: string; search: string };

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

export function BiometricsList({ users }: { users: BioRow[] }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => { const t = queryTerms(q); return users.filter((u) => matchesTerms(u.search, t)); }, [q, users]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder="이름·인증방식·동의 검색" />
      </div>
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>인증방식</th>
                <th style={th}>생체정보 동의</th>
                <th style={{ ...th, textAlign: "right" }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "표시할 사용자가 없습니다."}
                  </td>
                </tr>
              ) : (
                list.map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>{u.initial}</div>
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span style={{ fontWeight: 700 }}>
                            {u.name}
                            {u.isAdmin && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}> (관리자)</span>}
                          </span>
                          {u.employeeNo && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}>사번 {u.employeeNo}</span>}
                        </div>
                      </div>
                    </td>
                    <td style={{ ...td, color: u.hasAuth ? "var(--text)" : "#9CA3AF" }}>{u.authLabel}</td>
                    <td style={td}>
                      {u.consented ? (
                        <span style={{ color: "#15803D", fontWeight: 700 }}>
                          동의함 <span style={{ color: "var(--text-sub)", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>({u.consentDateLabel})</span>
                        </span>
                      ) : (
                        <span style={{ color: "#9CA3AF" }}>동의 안 함</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {u.consented ? (
                        <form action={adminRevokeBiometric} style={{ display: "inline" }}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" style={{ height: 34, padding: "0 14px", border: "1px solid var(--danger)", borderRadius: 8, background: "#fff", color: "var(--danger)", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>파기</button>
                        </form>
                      ) : (
                        <span style={{ color: "#D1D5DB" }}>—</span>
                      )}
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
