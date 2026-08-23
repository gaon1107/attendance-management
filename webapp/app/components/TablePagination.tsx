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

  // ── 나눌 페이지가 없으면 이 줄을 통째로 감춘다 (2026-08-23 디자인 검토) ──
  // 표가 0~3줄뿐인 화면에도 "페이지 당 행: 100 · 0–0 / 0 · ‹ ›"가 늘 붙어 있어 화면이 시끄러웠다.
  //
  // ⚠️ 판단 기준이 `pageCount <= 1`이 **아닌** 이유 — 그렇게 하면 되돌릴 수 없는 함정이 생긴다:
  //     건수 60 · 크기 50 → 2페이지라 줄이 보인다 → 사용자가 크기를 200으로 바꾼다
  //     → 1페이지가 되어 줄이 사라진다 → **크기를 50으로 되돌릴 방법이 없다.**
  //   그래서 "고를 수 있는 가장 작은 크기"보다도 건수가 적을 때만 감춘다.
  //   이러면 어떤 크기를 골라도 항상 1페이지인 게 확실하므로, 감춰도 잃는 조작이 없다.
  const minSize = Math.min(...sizeOptions);
  if (total <= minSize) return null;

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
