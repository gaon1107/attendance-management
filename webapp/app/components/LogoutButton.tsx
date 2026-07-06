// 공통 로그아웃 버튼 — 모든 로그인 화면의 상단바 우측에 표시(AppShell에서 렌더).
// 서버 동작(logout)을 그대로 호출하는 form 버튼. 아이콘 + "로그아웃" 글자로 명확하게.
import { logout } from "@/app/actions/auth";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        title="로그아웃"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 36,
          padding: "0 14px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "#fff",
          color: "var(--text-sub)",
          fontFamily: "inherit",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{ width: 16, height: 16, display: "flex" }}
          dangerouslySetInnerHTML={{
            __html:
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
          }}
        />
        로그아웃
      </button>
    </form>
  );
}
