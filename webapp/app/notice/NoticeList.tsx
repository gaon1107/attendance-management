"use client";
// 공지 목록(카드) + 통합검색 — 제목·내용·작성자로 즉시 필터. 관리자는 삭제 서버액션 유지.
import { useMemo, useState } from "react";
import { SearchBox } from "@/app/components/SearchBox";
import { queryTerms, matchesTerms } from "@/lib/search";
import { deleteNotice } from "@/app/actions/notice";

export type NoticeRow = { id: string; title: string; body: string; authorName: string; dateLabel: string; isNew: boolean; search: string };

export function NoticeList({ notices, isAdmin }: { notices: NoticeRow[]; isAdmin: boolean }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => { const t = queryTerms(q); return notices.filter((n) => matchesTerms(n.search, t)); }, [q, notices]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder="제목·내용·작성자 검색" />
      </div>

      {list.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "40px 20px", textAlign: "center", fontSize: 14, color: "var(--text-sub)" }}>
          {q.trim() ? "검색 결과가 없습니다." : "아직 등록된 공지가 없습니다."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {list.map((n) => (
            <article key={n.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>
                  {n.isNew && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "var(--danger)", borderRadius: 5, padding: "2px 6px", marginRight: 8, verticalAlign: "middle" }}>NEW</span>
                  )}
                  {n.title}
                </div>
                {isAdmin && (
                  <form action={deleteNotice}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", color: "var(--text-sub)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                      삭제
                    </button>
                  </form>
                )}
              </div>
              <div style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{n.body}</div>
              <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 12 }}>
                {n.authorName} · {n.dateLabel}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
