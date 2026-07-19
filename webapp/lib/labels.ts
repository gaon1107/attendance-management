// 근태 화면 공통 라벨/포맷 — 근무형태·위치확인 결과·시각 표시를 여러 화면에서 똑같이 쓴다.

// 근무형태: office/home/field
export function workModeLabel(mode: string): string {
  return mode === "home" ? "재택" : mode === "field" ? "외근" : "사무실";
}

// 위치 확인 결과(사무실만 의미 있음)
export function locationLabel(status: string | null): string {
  if (status === "verified") return "확인됨";
  if (status === "out_of_range") return "벗어남";
  if (status === "unavailable") return "확인 불가";
  return "—"; // 재택/외근 등 위치 확인 안 함
}

// "14:05" 형태(24시간, 로컬)
export function hhmm(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// 퇴근이 출근보다 "며칠 뒤 날짜"인지(캘린더 자정 경계 기준, 로컬 TZ). 같은 날이면 0, 다음날이면 1 ...
//  · 야근(자정 넘김)·퇴근 안 찍고 방치된 기록을 눈으로 구분·확인하기 위한 값.
export function clockDayOffset(clockIn: Date, clockOut: Date): number {
  const a = new Date(clockIn.getFullYear(), clockIn.getMonth(), clockIn.getDate()).getTime();
  const b = new Date(clockOut.getFullYear(), clockOut.getMonth(), clockOut.getDate()).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

// 퇴근 시각 + 날 넘김 표기 — 같은 날이면 "18:00", 날을 넘겼으면 "06:00 (+1일)".
//  · 근태 이력을 보여주는 모든 화면에서 동일하게 쓰기 위한 공용 표기(내근태·직원상세·근태현황·근로기록부·엑셀).
export function clockOutText(clockIn: Date, clockOut: Date): string {
  const off = clockDayOffset(clockIn, clockOut);
  return off > 0 ? `${hhmm(clockOut)} (+${off}일)` : hhmm(clockOut);
}

// "07/06(월)" 형태
export function monthDayDow(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", weekday: "short" });
}
