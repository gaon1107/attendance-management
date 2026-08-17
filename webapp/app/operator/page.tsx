// 운영자(본사) 홈 — 회원사 현황.
//
// 🔴 로그인 검사는 **여기 맨 위**에서 한다(layout이 아니라). 이유는 app/operator/layout.tsx 주석.
// 🔴 이 화면은 회사 칸막이(companyId 격리)를 넘어 **전체 회원사**를 보는 유일한 자리다.
//    그래서 지켜야 하는 선이 있다 — 직원 개인 이름·개별 근태·얼굴 정보는 **보여주지 않는다.**
//    회사별 합계 숫자만 본다. (우리가 고객사 직원의 출퇴근을 들여다볼 수 있으면 그건 우리 쪽
//    개인정보 문제가 된다)
//
// ※ 지금은 로그인 문까지만 만든 상태다(2026-08-18, 1단계 ①). 회원사 목록은 다음 커밋(②)에서
//   이 화면에 붙인다 — 페이지 나누기·검색·상태 필터와 함께.
import { redirect } from "next/navigation";
import { getCurrentOperator } from "@/lib/operator-session";
import { operatorLogout } from "@/app/actions/operator";

export const dynamic = "force-dynamic";

export default async function OperatorHomePage() {
  const me = await getCurrentOperator();
  if (!me) redirect("/operator/login");

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* 상단 바 — 고객사 사이드바를 쓰지 않으므로 여기서 직접 그린다(layout.tsx 주석 참고) */}
      <header
        style={{
          height: 60,
          background: "var(--rail)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 크기 고정 로고. 최적화 대상 아님 */}
          <img src="/logo.webp" alt="가온" width={144} height={120} style={{ height: 26, width: "auto", display: "block" }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>운영자</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 13, color: "var(--rail-text)" }}>{me.name}</span>
          <form action={operatorLogout}>
            <button
              type="submit"
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid var(--rail-line)",
                background: "transparent",
                color: "var(--rail-text)",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>회원사 현황</h1>
        <p style={{ fontSize: 14, color: "var(--text-sub)", margin: "0 0 24px" }}>
          가입한 회사와 체험 상태를 확인합니다.
        </p>

        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 32,
            fontSize: 14,
            color: "var(--text-sub)",
            lineHeight: 1.7,
          }}
        >
          회원사 목록은 다음 단계에서 이 자리에 붙습니다.
          <br />
          지금은 <b style={{ color: "var(--text)" }}>운영자 로그인</b>까지 만들어진 상태입니다.
        </div>
      </main>
    </div>
  );
}
