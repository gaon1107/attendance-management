// 공통 화면 뼈대 — 사이드바 + 상단바 + 화면 폭을 꽉 채우는 콘텐츠.
// 모든 로그인 화면이 이걸 통해 같은 레이아웃 기준(폭·여백·반응형)을 쓴다.
// (구 narrow 옵션=640px 중앙정렬은 2026-07-09 전 화면 전체 폭 규칙으로 폐지됨.)
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Sidebar, type NavKey } from "@/app/components/Sidebar";
import { LogoutButton } from "@/app/components/LogoutButton";
import { NotificationBell } from "@/app/components/NotificationBell";
import { NavProvider, NavOpenButton } from "@/app/components/MobileNav";
import { HelpFab } from "@/app/components/HelpFab";
import { helpFor, type HelpKey } from "@/lib/help-content";
import { guideSectionHref } from "@/lib/guide";

// ⚠️ isOwner를 여기 적어 두는 이유: 사이드바가 이 값으로 "내 근태" 묶음을 줄지 정한다.
//    타입에 없으면 어느 화면에서 user를 줄여 넘겨도 tsc가 통과해, 회사 계정에 근태 메뉴가 조용히 되살아난다(검수 2차 10).
// ⚠️ mustChangePassword를 여기 두는 이유(검수 H-4): 임시 비밀번호로 들어온 사람이
//    주소창에 다른 주소를 직접 쳐서 강제 변경 화면을 건너뛰던 문제를 한 곳에서 막기 위함.
//    예전엔 [출퇴근]·[대시보드] 두 화면에서만 막아, 그 외 화면은 전부 통과했다.
// ⚠️ shiftMode를 여기 두는 이유(2026-08-23): 사이드바가 이 값으로 [근무표] 메뉴를 줄지 정한다(Sidebar.tsx 참고).
//    isOwner와 **똑같은 함정**이 있다 — 타입에 없으면 user를 줄여 넘겨도 tsc가 통과해,
//    교대근무 회사에서 [근무표] 메뉴가 조용히 사라진다. 그래서 여기에도 적어 둔다.
type ShellUser = { id?: string; name: string; role: string; isOwner?: boolean; companyId?: string; mustChangePassword?: boolean; company: { name: string; logoName?: string | null; approvalMode?: string | null; shiftMode?: number | null } };

// ⚠️ async 서버 컴포넌트다(떠 있는 [도움말]의 안내서 링크를 만들 때 사본 정보를 읽는다).
//    호출하는 화면 54곳은 그대로 <AppShell …>로 쓰면 된다 — 이미 Sidebar 도 async 서버 컴포넌트다.
export async function AppShell({
  user,
  active,
  title,
  subtitle,
  right,
  helpKey,
  children,
}: {
  user: ShellUser;
  active: NavKey;
  title: string;
  subtitle?: string;
  right?: ReactNode; // 상단바 오른쪽(버튼·날짜 등)
  /** 떠 있는 [도움말]이 보여줄 설명을 지정한다. 생략하면 `active` 를 쓴다.
   *  ⚠️ **한 active 키를 여러 화면이 나눠 쓸 때만** 넘긴다(정정 승인·얼굴 등록·동의·직원 상세·근태 상세). */
  helpKey?: HelpKey;
  children: ReactNode;
}) {
  // 🔒 임시 비밀번호로 로그인한 상태면 어떤 화면도 열지 않고 새 비밀번호 설정으로 보낸다(검수 H-4).
  //    이 컴포넌트를 로그인 화면 46개가 모두 거치므로, 새 화면을 만들어도 자동으로 보호된다.
  if (user.mustChangePassword) redirect("/change-password");

  // 떠 있는 [도움말] 버튼 — **이 화면에 대한 설명이 있을 때만** 그린다(빈 창을 보여 주지 않는다).
  //  · [도움말] 화면 자신에서는 숨긴다 — 이미 안내서를 보고 있는 자리라 군더더기다.
  //  · 안내서 링크는 역할에 맞는 안내서만 만들어진다(직원에게 관리자 안내서를 권하지 않는다).
  //  · ⚠️ 한 `active` 키를 여러 화면이 나눠 쓴다(예: [근태 현황]과 [정정 승인]이 둘 다 "records").
  //    그런 화면은 `helpKey` 로 자기 설명을 지정한다 — 안 그러면 **다른 화면 사용법**이 뜬다(검수 중간 1).
  const helpEntry = active === "help" ? null : helpFor(helpKey ?? active, user.role);
  const helpGuideHref = helpEntry?.guide
    ? await guideSectionHref(helpEntry.guide.book, helpEntry.guide.anchor, user.role)
    : null;

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
        {/* 떠 있는 [도움말] — ⚠️ 반드시 <main> **안**에 둔다. 폰에서 메뉴 서랍이 열리면 MobileNav 가
            `.app-main` 에 inert 를 걸어 뒤에 가려진 버튼을 Tab 으로 못 누르게 막는데, 밖에 두면
            그 보호를 받지 못해 **안 보이는 버튼이 눌린다**(검수 중간 4). 자리는 position:fixed 라 그대로다. */}
        {helpEntry && <HelpFab entry={helpEntry} guideHref={helpGuideHref} guideLabel={helpEntry.guide?.label ?? null} />}
      </main>
    </NavProvider>
  );
}
