// 상단바 알림 종 — 처리 필요 총건수를 배지로 보여주고 누르면 알림 센터로 간다. (관리자 전용)
// 실시간 카운트(읽음 저장 없음). 집계 실패해도 헤더는 떠야 하므로 실패 시 배지 없이 종만 표시한다.
import Link from "next/link";
import { listAdminNotifications } from "@/lib/notifications";

export async function NotificationBell({ companyId }: { companyId: string }) {
  let total = 0;
  try {
    total = (await listAdminNotifications(companyId)).total;
  } catch (e) {
    console.warn("[NotificationBell] 알림 집계 실패(헤더는 정상):", e);
  }

  return (
    <Link
      href="/notifications"
      title="알림 센터"
      aria-label={`알림 센터${total > 0 ? ` (처리 필요 ${total}건)` : ""}`}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 8, color: "#374151", textDecoration: "none" }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {total > 0 && (
        <span
          style={{ position: "absolute", top: 3, right: 3, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
        >
          {total > 99 ? "99+" : total}
        </span>
      )}
    </Link>
  );
}
