"use client";
// 생체정보(동의 현황) 목록 + 통합검색 — 이름·인증방식·동의여부로 즉시 필터. 파기 서버액션 유지.
import { useMemo, useState } from "react";
import { SearchBox } from "@/app/components/SearchBox";
import { TablePagination } from "@/app/components/TablePagination";
import { usePagination } from "@/app/components/usePagination";
import { queryTerms, matchesTerms } from "@/lib/search";
import { adminRevokeBiometric } from "@/app/actions/authmethod";

// deactivated = 퇴사자 / faceLeft = 동의는 없는데 등록 얼굴이 남음(얼굴서버 삭제 실패) — 둘 다 2026-11-19 M8
export type BioRow = { id: string; name: string; employeeNo: string | null; initial: string; isAdmin: boolean; authLabel: string; hasAuth: boolean; consented: boolean; consentDateLabel: string; deactivated: boolean; faceLeft: boolean; search: string };

// [5-2 검수 C1·L4] [파기]는 되돌릴 수 없으므로 누르기 전에 "무엇이 지워지는지"를 확인받는다.
//  재직자와 퇴사자는 지우는 범위가 다르다(퇴사자는 출퇴근 사진을 90일 보관 — app/actions/authmethod.ts adminRevokeBiometric).
function revokeConfirmText(u: BioRow): string {
  if (u.deactivated) {
    return (
      `${u.name} 님(퇴사)의 생체정보를 파기할까요?\n\n` +
      `· 얼굴인증 서버에 남은 등록 얼굴을 지웁니다.\n` +
      `· 출퇴근 촬영 사진은 지금 지우지 않고, 동의 내용대로 90일 뒤 자동 삭제됩니다.\n\n` +
      `지운 얼굴은 되돌릴 수 없습니다.`
    );
  }
  return (
    `${u.name} 님의 생체정보를 파기할까요?\n\n` +
    `· 생체정보 동의가 철회되고 인증방식이 GPS로 바뀝니다.\n` +
    `· 얼굴인증 서버의 등록 얼굴과 보관 중인 출퇴근 촬영 사진을 지금 지웁니다.\n\n` +
    `지운 얼굴·사진은 되돌릴 수 없습니다. 다시 얼굴인증을 쓰려면 본인이 새로 동의·등록해야 합니다.`
  );
}

const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 20px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "12px 20px", fontSize: 15, verticalAlign: "middle", whiteSpace: "nowrap" };

export function BiometricsList({ users }: { users: BioRow[] }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => { const t = queryTerms(q); return users.filter((u) => matchesTerms(u.search, t)); }, [q, users]);
  const pg = usePagination(list, { initialSize: 100, resetKey: q });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder="이름·인증방식·동의 검색" />
      </div>
      <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 700, color: "var(--text-sub)" }}>
          직원 {list.length}명{q ? ` (검색 결과 · 전체 ${users.length}명)` : ""}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead>
              <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>이름</th>
                <th style={th}>사번</th>
                <th style={th}>인증방식</th>
                <th style={th}>생체정보 동의</th>
                <th style={{ ...th, textAlign: "right" }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {pg.view.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "28px 20px", fontSize: 14, color: "var(--text-sub)", textAlign: "center" }}>
                    {q.trim() ? "검색 결과가 없습니다." : "표시할 사용자가 없습니다."}
                  </td>
                </tr>
              ) : (
                pg.view.map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#EEF2F7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>{u.initial}</div>
                        <span style={{ fontWeight: 700 }}>
                          {u.name}
                          {u.isAdmin && <span style={{ fontSize: 12, color: "var(--text-sub)", fontWeight: 400 }}> (관리자)</span>}
                        </span>
                        {u.deactivated && (
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", background: "#F3F4F6", borderRadius: 6, padding: "2px 8px" }}>퇴사</span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...td, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{u.employeeNo || "—"}</td>
                    <td style={{ ...td, color: u.hasAuth ? "var(--text)" : "#9CA3AF" }}>{u.authLabel}</td>
                    <td style={td}>
                      {u.consented ? (
                        <span style={{ color: "#15803D", fontWeight: 700 }}>
                          동의함 <span style={{ color: "var(--text-sub)", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>({u.consentDateLabel})</span>
                        </span>
                      ) : u.faceLeft ? (
                        <span style={{ color: "var(--danger)", fontWeight: 700 }}>얼굴 남음 — 파기 필요</span>
                      ) : (
                        <span style={{ color: "#9CA3AF" }}>동의 안 함</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {/* 동의가 있거나, 동의는 없는데 얼굴이 남은 경우(삭제 재시도) 모두 [파기]를 보인다 — 서버 액션이 고아 상태도 처리한다 */}
                      {u.consented || u.faceLeft ? (
                        <form
                          action={adminRevokeBiometric}
                          onSubmit={(e) => {
                            if (!confirm(revokeConfirmText(u))) e.preventDefault();
                          }}
                          style={{ display: "inline" }}
                        >
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
        <TablePagination pg={pg} />
      </section>
    </>
  );
}
