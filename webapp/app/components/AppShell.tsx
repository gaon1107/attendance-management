// 공통 화면 뼈대 — 사이드바 + 상단바 + 화면 폭을 꽉 채우는 콘텐츠.
// 모든 로그인 화면이 이걸 통해 같은 레이아웃 기준(폭·여백·반응형)을 쓴다.
// (구 narrow 옵션=640px 중앙정렬은 2026-07-09 전 화면 전체 폭 규칙으로 폐지됨.)
import type { ReactNode } from "react";
import { Sidebar, type NavKey } from "@/app/components/Sidebar";
import { LogoutButton } from "@/app/components/LogoutButton";

type ShellUser = { name: string; role: string; company: { name: string; logoName?: string | null } };

export function AppShell({
  user,
  active,
  title,
  subtitle,
  right,
  children,
}: {
  user: ShellUser;
  active: NavKey;
  title: string;
  subtitle?: string;
  right?: ReactNode; // 상단바 오른쪽(버튼·날짜 등)
  children: ReactNode;
}) {
  return (
    <div className="app-row">
      <Sidebar user={user} active={active} />
      <main className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-title">
            <span style={{ fontSize: 18, fontWeight: 700, whiteSpace: "nowrap" }}>{title}</span>
            {subtitle && (
              <span style={{ fontSize: 13, color: "#9CA3AF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {subtitle}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {right}
            <LogoutButton />
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
