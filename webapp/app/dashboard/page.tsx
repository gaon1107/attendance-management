// 관리자 대시보드 (임시) — 로그인 성공을 확인하는 자리.
// 다음 단계에서 실제 근태 현황 화면으로 채운다. 로그인 안 했으면 로그인 화면으로 보낸다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { logout } from "@/app/actions/auth";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div style={{ minHeight: "100vh", padding: "48px 24px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
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
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 28,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {user.name}님, 환영합니다 👋
          </div>
          <div style={{ fontSize: 15, color: "var(--text-sub)", lineHeight: 1.7 }}>
            회사: <b style={{ color: "var(--text)" }}>{user.company.name}</b>
            <br />
            역할: {user.role === "admin" ? "관리자" : "직원"}
            <br />
            이메일: {user.email}
          </div>
          <div style={{ marginTop: 20, fontSize: 13, color: "var(--text-sub)" }}>
            (다음 단계에서 이 자리에 오늘 출퇴근 현황이 채워집니다.)
          </div>

          <form action={logout} style={{ marginTop: 24 }}>
            <button
              type="submit"
              style={{
                height: 44,
                padding: "0 20px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "#fff",
                color: "var(--text)",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
