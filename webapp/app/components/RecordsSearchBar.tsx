// 근태현황 전용 검색바 — 시작·종료 날짜(달력) + 통합 검색어. GET 폼으로 /records 로 이동한다.
// ※ 서버 컴포넌트(별도 JS 불필요): 브라우저 기본 달력(input type=date)과 폼 제출만 사용해 안정적이다.
//   일/주/월 이동막대(PeriodNav)는 이 화면에서 쓰지 않는다(다른 화면은 그대로 유지).

const inputStyle: React.CSSProperties = {
  height: 38,
  padding: "0 10px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "#fff",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
};

export function RecordsSearchBar({ from, to, q }: { from: string; to: string; q: string }) {
  return (
    <form method="get" action="/records" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="date" name="from" defaultValue={from} aria-label="검색 시작 날짜" style={inputStyle} />
        <span style={{ color: "var(--text-sub)" }}>~</span>
        <input type="date" name="to" defaultValue={to} aria-label="검색 종료 날짜" style={inputStyle} />
      </div>
      <input
        type="text"
        name="q"
        defaultValue={q}
        placeholder="이름·위치·시간 등 전체 검색"
        style={{ ...inputStyle, minWidth: 200, flex: 1 }}
      />
      <button
        type="submit"
        style={{ height: 38, padding: "0 20px", border: "none", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        검색
      </button>
    </form>
  );
}
