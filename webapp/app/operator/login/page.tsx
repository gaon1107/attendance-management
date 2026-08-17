// 운영자(본사) 로그인 화면.
//
// ⚠️ 쿠키를 읽어야 "이미 로그인돼 있는지"를 알 수 있으므로 서버 컴포넌트다.
//    그리고 그 판단이 든 화면은 절대 캐시되면 안 된다 → force-dynamic.
import { redirect, unstable_rethrow } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator-session";
import { OperatorLoginForm } from "./OperatorLoginForm";

export const dynamic = "force-dynamic";

export default async function OperatorLoginPage() {
  // 이미 로그인돼 있으면 목록으로 보낸다(로그인 화면을 다시 볼 이유가 없다).
  //  ※ 조회가 실패해도 로그인 화면 자체는 떠야 한다 — 그래야 다시 시도할 수 있다.
  try {
    if (await getCurrentOperator()) redirect("/operator");
  } catch (e) {
    // ⚠️ Next의 redirect·동적 렌더 알림은 예외로 전달된다 — 삼키면 이동이 취소되거나
    //    이 화면이 조용히 정적 페이지가 된다(app/login/page.tsx와 같은 처방).
    unstable_rethrow(e);
    console.warn("[operator/login] 세션 조회 실패(로그인 화면 표시):", e instanceof Error ? e.message : String(e));
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
      }}
    >
      {/* 로고 + [운영자] 표시 — 고객사 로그인 화면과 **한눈에 구분되도록** 표를 붙였다.
          (같은 모양이면 사장님이 어느 문에 서 있는지 헷갈린다) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 크기 고정 로고. 최적화 대상 아님 */}
        <img src="/logo.webp" alt="가온" width={144} height={120} style={{ height: 34, width: "auto", display: "block" }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.06em",
            color: "#fff",
            background: "var(--rail)",
            borderRadius: 5,
            padding: "4px 8px",
          }}
        >
          운영자
        </span>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 32,
        }}
      >
        <OperatorLoginForm />
      </div>
    </div>
  );
}
