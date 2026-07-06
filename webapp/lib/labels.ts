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

// "07/06(월)" 형태
export function monthDayDow(d: Date): string {
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", weekday: "short" });
}
