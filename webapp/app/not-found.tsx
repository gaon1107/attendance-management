// 404 화면 — 없는 주소로 왔을 때. (notFound() 호출 시에도 표시된다)
import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ fontSize: 56, fontWeight: 700, color: "var(--primary)", lineHeight: 1, marginBottom: 12 }}>404</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>페이지를 찾을 수 없어요</div>
        <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 24, lineHeight: 1.6 }}>
          주소가 바뀌었거나, 접근 권한이 없는 페이지일 수 있습니다.
        </p>
        <Link
          href="/"
          style={{ display: "inline-flex", height: 48, padding: "0 24px", alignItems: "center", borderRadius: 10, background: "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
        >
          홈으로 가기
        </Link>
      </div>
    </div>
  );
}
