// 로그인 화면.
// ⚠️ 서버 컴포넌트인 이유: "지금 누가 로그인돼 있는지"는 쿠키를 읽어야 알 수 있고, 그건 서버에서만 된다.
//    (검수 M-15 경고 배너용 — 상세는 LoginForm.tsx 주석)
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

// 🔒 이 화면은 이제 **로그인한 사람의 실명**을 담는다(경고 배너). 절대 캐시되면 안 된다.
//    캐시되면 A의 이름이 든 화면이 B에게 그대로 나갈 수 있다(사무실이 공인 IP·프록시를 함께 쓰는
//    중소기업이 타겟이라 가정이 아니다). 프레임워크가 알아서 동적 처리하더라도, 앞단 프록시·CDN까지
//    막으려면 명시가 필요하다.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // allowMustChange: 임시 비밀번호 상태로 여기 온 사람도 "로그인돼 있음"으로 알려줘야 한다
  //  (그 상태에서 다른 계정으로 로그인해도 기존 세션은 똑같이 날아간다).
  //  ※ 조회가 실패해도 로그인 화면 자체는 떠야 한다 — 배너만 생략한다.
  let signedInName: string | null = null;
  let mustChange = false;
  try {
    const me = await getCurrentUser({ allowMustChange: true });
    signedInName = me?.name ?? null;
    mustChange = me?.mustChangePassword ?? false;
  } catch (e) {
    // ⚠️ Next가 "이 페이지는 동적이다"를 알리려고 던지는 내부 에러까지 삼키면 안 된다(검수 중간 7).
    //    삼키면 이 화면이 조용히 정적 페이지가 되어 **남의 이름이 박힌 HTML**이 돌아다닐 수 있다.
    unstable_rethrow(e);
    console.warn("[login] 현재 로그인 사용자 조회 실패(배너 생략):", e instanceof Error ? e.message : String(e));
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
      }}
    >
      {/* 로고 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          근
        </div>
        <span style={{ fontSize: 18, fontWeight: 700 }}>근태관리</span>
      </div>

      {/* 카드 */}
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 36px 32px",
        }}
      >
        <LoginForm signedInName={signedInName} mustChange={mustChange} />
      </div>
    </div>
  );
}
