"use client";
// 공통 페이징 푸터 — "페이지 당 행: [50/100/200] · start–end / total · ◀ ▶" (표 아래에 붙인다).
//  · 상태는 usePagination 훅이 소유. 이 컴포넌트는 표시·조작 UI만.
//  · 처음 개발: 목록 화면 페이징(2026-07). 공통 부품.
import type { Pagination } from "./usePagination";

const DEFAULT_SIZE_OPTS = [50, 100, 200];

const selectStyle: React.CSSProperties = {
  height: 32, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 8,
  fontFamily: "inherit", fontSize: 13, background: "#fff", color: "var(--text)", cursor: "pointer",
};
const arrowStyle = (disabled: boolean): React.CSSProperties => ({
  width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", borderRadius: 8, background: "#fff",
  color: disabled ? "#C4C9D2" : "var(--text-sub)", fontSize: 16, fontWeight: 700,
  cursor: disabled ? "default" : "pointer",
});

export function TablePagination<T>({ pg, sizeOptions = DEFAULT_SIZE_OPTS }: { pg: Pagination<T>; sizeOptions?: number[] }) {
  const { total, size, page, pageCount, start, end, setPage, setSize } = pg;
  const from = total === 0 ? 0 : start + 1;
  const atFirst = page <= 0;
  const atLast = page >= pageCount - 1;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16, padding: "10px 16px", flexWrap: "wrap", borderTop: "1px solid var(--border)" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-sub)" }}>
        페이지 당 행:
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} style={selectStyle} aria-label="페이지 당 행 수">
          {sizeOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </label>

      <span style={{ fontSize: 13, color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>
        {from}–{end} / {total}
      </span>

      <div style={{ display: "inline-flex", gap: 4 }}>
        <button type="button" onClick={() => setPage(page - 1)} disabled={atFirst} aria-label="이전 페이지" style={arrowStyle(atFirst)}>‹</button>
        <button type="button" onClick={() => setPage(page + 1)} disabled={atLast} aria-label="다음 페이지" style={arrowStyle(atLast)}>›</button>
      </div>
    </div>
  );
}
