// 공통 상단 메뉴 — 로그인한 화면들 위에 표시. 역할에 따라 메뉴가 다르다.
import Link from "next/link";
import { logout } from "@/app/actions/auth";

type NavUser = {
  name: string;
  role: string;
  company: { name: string };
};

export function TopNav({ user }: { user: NavUser }) {
  const isAdmin = user.role === "admin";
  const linkStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text)",
    textDecoration: "none",
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--border)",
        background: "#fff",
        padding: "14px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "var(--primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            근
          </div>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{user.company.name}</span>
        </div>
        <nav style={{ display: "flex", gap: 16 }}>
          {isAdmin && <Link href="/dashboard" style={linkStyle}>대시보드</Link>}
          {isAdmin && <Link href="/employees" style={linkStyle}>직원관리</Link>}
          <Link href="/attendance" style={linkStyle}>내 출퇴근</Link>
          {isAdmin && <Link href="/settings" style={linkStyle}>설정</Link>}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 13, color: "var(--text-sub)" }}>
          {user.name} ({isAdmin ? "관리자" : "직원"})
        </span>
        <form action={logout}>
          <button
            type="submit"
            style={{
              height: 34,
              padding: "0 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "#fff",
              color: "var(--text)",
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
  );
}
