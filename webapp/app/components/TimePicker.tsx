"use client";
// 공통 시간 선택 — [시][분] 드롭다운. 값은 "HH:MM"(비었으면 ""=없음).
//  · allowEmpty(기본 true): "없음" 선택 허용(시각을 안 정하는 경우). false면 항상 시각을 골라야 한다.
//  · 분은 10분 단위(00,10,20,30,40,50). 필요하면 minutes prop으로 교체.
//  · splitTime/joinTime 헬퍼로 "HH:MM" ↔ {h,m} 변환을 표준화한다.
//  · 처음 개발: 설정 근무제·기준시간(2026-07). 표준 컴포넌트로 승격.

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
export const TIME_MINUTES = ["00", "10", "20", "30", "40", "50"];

// "HH:MM" → {h, m}. 값이 없거나 형식이 안 맞으면 "없음"(h="").
export function splitTime(t: string, minutes: string[] = TIME_MINUTES): { h: string; m: string } {
  if (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
    const [h, m] = t.split(":");
    return { h, m: minutes.includes(m) ? m : minutes[0] };
  }
  return { h: "", m: minutes[0] };
}

// {h, m} → "HH:MM"(h가 비었으면 "").
export const joinTime = (h: string, m: string) => (h === "" ? "" : `${h}:${m}`);

const selectStyle: React.CSSProperties = {
  height: 44,
  padding: "0 10px",
  border: "1px solid #D1D5DB",
  borderRadius: 8,
  fontFamily: "inherit",
  fontSize: 15,
  background: "#fff",
  color: "var(--text)",
  cursor: "pointer",
  flex: 1,
  minWidth: 0,
};

export function TimePicker({
  h,
  m,
  onH,
  onM,
  allowEmpty = true,
  minutes = TIME_MINUTES,
}: {
  h: string;
  m: string;
  onH: (v: string) => void;
  onM: (v: string) => void;
  allowEmpty?: boolean;
  minutes?: string[];
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <select value={h} onChange={(e) => onH(e.target.value)} style={selectStyle}>
        {allowEmpty && <option value="">없음</option>}
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>{hh}시</option>
        ))}
      </select>
      <select value={m} onChange={(e) => onM(e.target.value)} style={{ ...selectStyle, opacity: h === "" ? 0.5 : 1 }} disabled={h === ""}>
        {minutes.map((mm) => (
          <option key={mm} value={mm}>{mm}분</option>
        ))}
      </select>
    </div>
  );
}
