// 공통 화면 뼈대 — 사이드바 + 상단바 + 화면 폭을 꽉 채우는 콘텐츠(폼 화면만 narrow로 좁게).
// 모든 로그인 화면이 이걸 통해 같은 레이아웃 기준(폭·여백·반응형)을 쓴다.
import type { ReactNode } from "react";
import { Sidebar, type NavKey } from "@/app/components/Sidebar";

type ShellUser = { name: string; role: string; company: { name: string } };

export function AppShell({
  user,
  active,
  title,
  subtitle,
  right,
  narrow = false,
  children,
}: {
  user: ShellUser;
  active: NavKey;
  title: string;
  subtitle?: string;
  right?: ReactNode; // 상단바 오른쪽(버튼·날짜 등)
  narrow?: boolean; // true면 콘텐츠를 좁은 폭(640px)으로 중앙 정렬 (폼·출퇴근 화면용)
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
          {right && <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>{right}</div>}
        </header>
        <div className="page">{narrow ? <div className="narrow">{children}</div> : children}</div>
      </main>
    </div>
  );
}
