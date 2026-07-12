"use client";
// 공통 통합검색 입력창 — 타이핑 즉시 필터(상태는 부모가 소유). 값이 있으면 [지우기] 버튼 표시.
//  · 필터 로직은 lib/search.ts(queryTerms/matchesTerms/filterByQuery)를 함께 쓴다.
//  · 처음 개발: 근태현황 통합검색(2026-07). 표준 컴포넌트로 승격.

export function SearchBox({
  value,
  onChange,
  placeholder = "검색어(여러 개는 띄어쓰기 = OR)",
  width = 240,
  ariaLabel = "통합 검색",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
  ariaLabel?: string;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={{ width, maxWidth: "100%", height: 38, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text)", fontSize: 14, fontFamily: "inherit" }}
      />
      {value.trim() && (
        <button
          type="button"
          onClick={() => onChange("")}
          style={{ height: 38, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          지우기
        </button>
      )}
    </div>
  );
}
