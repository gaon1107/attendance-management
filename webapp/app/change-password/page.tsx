// 새 비밀번호 설정(강제) — 임시 비밀번호로 로그인한 직원이 반드시 거치는 화면.
// 임시 비밀번호(현재 비밀번호)를 확인하고 새 비밀번호로 바꾼다. 바꾸면 원래 화면으로 이동한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ForcedChangeForm } from "./ForcedChangeForm";

export default async function ChangePasswordPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const home = me.role === "admin" ? "/dashboard" : "/attendance";
  // 임시 비밀번호 상태가 아니면 이 화면이 필요 없다 → 원래 쓰던 홈으로 보낸다.
  // (변경 성공 직후 서버가 이 가드를 다시 평가하며 홈으로 이동시키는 경로이기도 하다.)
  if (!me.mustChangePassword) redirect(home);

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
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>새 비밀번호 설정</div>
        <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 28, lineHeight: 1.6 }}>
          임시 비밀번호로 로그인하셨습니다. 안전을 위해 본인만 아는 새 비밀번호로 바꿔주세요.
        </div>
        <ForcedChangeForm home={home} />
      </div>
    </div>
  );
}
