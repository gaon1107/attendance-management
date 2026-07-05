// 리포트 기간 계산 — 일/주/월 단위로 시작·끝 날짜와 표시 라벨을 만든다.
export type Unit = "day" | "week" | "month";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

// unit이 아니면 month로 취급
export function normalizeUnit(u: string | undefined): Unit {
  return u === "day" || u === "week" ? u : "month";
}

// "YYYY-MM-DD" 문자열 → Date(없거나 이상하면 오늘)
export function parseAnchor(s: string | undefined): Date {
  if (s) {
    const d = new Date(s + "T00:00:00");
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

// Date → "YYYY-MM-DD"
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 기간(시작 이상, 끝 미만)과 라벨
export function rangeFor(unit: Unit, anchor: Date): { start: Date; end: Date; label: string } {
  if (unit === "day") {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1), label: fmtDate(start) };
  }
  if (unit === "week") {
    const diffToMon = (anchor.getDay() + 6) % 7; // 월요일까지 거슬러
    const start = startOfDay(addDays(anchor, -diffToMon));
    const end = addDays(start, 7);
    return { start, end, label: `${fmtDate(start)} ~ ${fmtDate(addDays(end, -1))}` };
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return { start, end, label: `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월` };
}

// 이전/다음 기준일
export function shiftAnchor(unit: Unit, anchor: Date, dir: 1 | -1): Date {
  if (unit === "day") return addDays(anchor, dir);
  if (unit === "week") return addDays(anchor, dir * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}
