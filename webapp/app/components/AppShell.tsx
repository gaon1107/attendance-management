// 공통 화면 뼈대 — 사이드바 + 상단바 + 화면 폭을 꽉 채우는 콘텐츠.
// 모든 로그인 화면이 이걸 통해 같은 레이아웃 기준(폭·여백·반응형)을 쓴다.
// (구 narrow 옵션=640px 중앙정렬은 2026-07-09 전 화면 전체 폭 규칙으로 폐지됨.)
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Sidebar, type NavKey } from "@/app/components/Sidebar";
import { LogoutButton } from "@/app/components/LogoutButton";
import { NotificationBell } from "@/app/components/NotificationBell";
import { NavProvider, NavOpenButton } from "@/app/components/MobileNav";

// ⚠️ isOwner를 여기 적어 두는 이유: 사이드바가 이 값으로 "내 근태" 묶음을 줄지 정한다.
//    타입에 없으면 어느 화면에서 user를 줄여 넘겨도 tsc가 통과해, 회사 계정에 근태 메뉴가 조용히 되살아난다(검수 2차 10).
// ⚠️ mustChangePassword를 여기 두는 이유(검수 H-4): 임시 비밀번호로 들어온 사람이
//    주소창에 다른 주소를 직접 쳐서 강제 변경 화면을 건너뛰던 문제를 한 곳에서 막기 위함.
//    예전엔 [출퇴근]·[대시보드] 두 화면에서만 막아, 그 외 화면은 전부 통과했다.
// ⚠️ shiftMode를 여기 두는 이유(2026-08-23): 사이드바가 이 값으로 [근무표] 메뉴를 줄지 정한다(Sidebar.tsx 참고).
//    isOwner와 **똑같은 함정**이 있다 — 타입에 없으면 user를 줄여 넘겨도 tsc가 통과해,
//    교대근무 회사에서 [근무표] 메뉴가 조용히 사라진다. 그래서 여기에도 적어 둔다.
type ShellUser = { id?: string; name: string; role: string; isOwner?: boolean; companyId?: string; mustChangePassword?: boolean; company: { name: string; logoName?: string | null; approvalMode?: string | null; shiftMode?: number | null } };

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
  // 🔒 임시 비밀번호로 로그인한 상태면 어떤 화면도 열지 않고 새 비밀번호 설정으로 보낸다(검수 H-4).
  //    이 컴포넌트를 로그인 화면 46개가 모두 거치므로, 새 화면을 만들어도 자동으로 보호된다.
  if (user.mustChangePassword) redirect("/change-password");

  return (
    // NavProvider가 .app-row를 대신 그린다 — 폰에서 [☰]로 여는 메뉴 서랍의 열림 상태를 들고 있어야 해서다.
    // (Sidebar는 그대로 서버 컴포넌트로 통과한다. 사이드바 내용·권한·조회는 하나도 바뀌지 않는다.)
    <NavProvider>
      <Sidebar user={user} active={active} />
      <main className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-title">
            {/* 폰에서만 보이는 메뉴 열기 버튼(PC에서는 CSS로 숨김) */}
            <NavOpenButton />
            <span style={{ fontSize: 18, fontWeight: 700, whiteSpace: "nowrap" }}>{title}</span>
            {subtitle && (
              <span style={{ fontSize: 13, color: "#9CA3AF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {subtitle}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {right}
            {/* 알림 종(관리자만) — 처리 필요 총건수 배지. 집계는 컴포넌트가 자체 수행(실패해도 헤더 정상). */}
            {user.role === "admin" && user.companyId && <NotificationBell companyId={user.companyId} />}
            <LogoutButton />
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
    </NavProvider>
  );
}
