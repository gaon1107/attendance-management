// 운영자 결제 화면 공용 조각(서버 컴포넌트) — [결제] 목록과 회사 상세 "결제" 칸이 같이 쓴다(2026-11-23 결제 6단계).
//  · 표시만 한다. 데이터는 lib/billing-operator.ts, 변경은 app/actions/operator-billing.ts.
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL } from "@/lib/billing-operator";

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function ymdhm(d: Date): string {
  return `${ymd(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** 이용 기간 끝(이 시각 전까지 이용) → "그 전날까지" 표시. 끝 시각은 언제나 자정이다(lib/billing-pay.ts periodBase). */
export function lastDayOf(end: Date): string {
  return ymd(new Date(end.getTime() - 1));
}
export function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

export const th: React.CSSProperties = { textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text-sub)", padding: "11px 14px", whiteSpace: "nowrap" };
export const td: React.CSSProperties = { padding: "11px 14px", fontSize: 14, verticalAlign: "top", whiteSpace: "nowrap" };

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "paid" ? { bg: "#DCFCE7", fg: "#166534" }
    : status === "cancelled" ? { bg: "#F3F4F6", fg: "#4B5563" }
    : status === "check" || status === "cancel_check" ? { bg: "#FFEDD5", fg: "#9A3412" }
    : { bg: "#FEE2E2", fg: "#991B1B" };
  return (
    <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap" }}>
      {ORDER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function typeLabel(t: string): string {
  return ORDER_TYPE_LABEL[t] ?? t;
}
