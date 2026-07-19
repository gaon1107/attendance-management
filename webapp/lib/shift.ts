// 교대근무(시프트) 순수 계산 — 그날 조 해석·순환·지각/조퇴 판정.
//  · DB·화면 접근 없음(순수함수) → 임시 라우트/스크립트로 경계값 검증한다.
//  · 시각 비교는 로컬 Date(서버 TZ=Asia/Seoul 가정). 날짜 인덱스는 Date.UTC 기반이라 TZ 무관·경계 안전.
//  · 설계: docs/04_architecture/교대근무_설계.md

export type ShiftLite = { order: number; startTime: string; endTime: string }; // "HH:MM"
export type RotationUnit = "day" | "week" | "month";

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// 야간(자정 넘김) 여부 — 퇴근이 출근과 같거나 이르면 익일로 본다(예 22:00~06:00).
export function crossesMidnight(s: { startTime: string; endTime: string }): boolean {
  return toMin(s.endTime) <= toMin(s.startTime);
}

// "YYYY-MM-DD" + "HH:MM" → 로컬 Date(그 날짜의 그 시각).
export function atDate(dateISO: string, hhmm: string): Date {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

// 다음날 "YYYY-MM-DD"
export function nextDayISO(dateISO: string): string {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const t = new Date(y, mo - 1, d + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

// TZ 무관 날짜 인덱스(에폭 이후 일수). 두 날짜의 차이를 정확히 세기 위한 것.
function dayIndexUTC(dateISO: string): number {
  const [y, mo, d] = dateISO.split("-").map(Number);
  return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
}

// 그 날짜가 속한 주의 "월요일" 날짜 인덱스(주 경계 = 월요일 00시, 주52 계산과 동일).
function mondayIndexUTC(dateISO: string): number {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=일 … 6=토
  const offsetToMon = (dow + 6) % 7; // 월=0 … 일=6
  return dayIndexUTC(dateISO) - offsetToMon;
}

// anchor부터 date까지 경과한 '단위 수'(정수, 과거면 음수). 순환 단계 이동량.
export function elapsedUnits(anchorISO: string, dateISO: string, unit: RotationUnit): number {
  if (unit === "day") return dayIndexUTC(dateISO) - dayIndexUTC(anchorISO);
  if (unit === "week") return (mondayIndexUTC(dateISO) - mondayIndexUTC(anchorISO)) / 7;
  // month
  const [ay, am] = anchorISO.split("-").map(Number);
  const [by, bm] = dateISO.split("-").map(Number);
  return (by * 12 + (bm - 1)) - (ay * 12 + (am - 1));
}

// 순환: 어떤 조(groupOrder)가 그 시점(steps 경과)에 맡는 shift order.
//  orderArr = 순환 순서(예 [1,2,3]). groupOrder(0,1,2)가 시작 offset.
export function rotationShiftOrder(groupOrder: number, steps: number, orderArr: number[]): number {
  const n = orderArr.length;
  if (n === 0) return 0;
  const idx = (((groupOrder + steps) % n) + n) % n; // 음수(과거) 보정
  return orderArr[idx];
}

// 지각 — 실제 출근이 (예정 출근 + 유예분)보다 늦으면 지각. 절대시각 비교라 야간조도 정확.
export function isLateByShift(clockIn: Date, dateISO: string, s: ShiftLite, graceMin: number): boolean {
  const planned = atDate(dateISO, s.startTime).getTime();
  return (clockIn.getTime() - planned) / 60000 > graceMin;
}

// 조퇴 — 실제 퇴근이 예정 퇴근보다 이르면 조퇴. 야간조는 예정 퇴근이 익일.
export function isEarlyLeaveByShift(clockOut: Date, dateISO: string, s: ShiftLite): boolean {
  const plannedOut = crossesMidnight(s)
    ? atDate(nextDayISO(dateISO), s.endTime).getTime()
    : atDate(dateISO, s.endTime).getTime();
  return clockOut.getTime() < plannedOut;
}
