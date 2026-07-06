"use client";
// 오류 화면(500 등) — 화면에서 예기치 못한 오류가 났을 때. Next 규칙상 클라이언트 컴포넌트여야 한다.
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 개발 중 원인 파악용 로그(운영에선 서버 로깅으로 대체)
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>문제가 발생했어요</div>
        <p style={{ fontSize: 14, color: "var(--text-sub)", marginBottom: 24, lineHeight: 1.6 }}>
          잠시 후 다시 시도해주세요. 계속 문제가 생기면 관리자에게 알려주세요.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{ height: 48, padding: "0 24px", border: "none", borderRadius: 10, background: "var(--primary)", color: "#fff", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
          >
            다시 시도
          </button>
          <Link
            href="/"
            style={{ display: "inline-flex", height: 48, padding: "0 24px", alignItems: "center", borderRadius: 10, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}
