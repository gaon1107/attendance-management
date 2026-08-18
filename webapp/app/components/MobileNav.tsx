"use client";
// 폰(좁은 화면) 전용 메뉴 서랍 — 상단바 [☰]로 열고, 뒷배경·[✕]·ESC·메뉴 선택으로 닫는다.
//
// ⚠️ 왜 클라이언트 컴포넌트인가:
//    Sidebar는 **서버 컴포넌트**라 "열림/닫힘" 같은 클릭 상태를 스스로 가질 수 없다.
//    그렇다고 사이드바의 기존 [접기] 방식(쿠키+서버액션)을 쓰면, 폰에서 연 서랍이
//    PC 화면의 접힘 상태까지 바꿔 버린다(쿠키는 화면 크기를 구분하지 못한다).
//    → 열림 상태만 이 작은 클라이언트 컴포넌트가 들고, 사이드바 자체는 손대지 않는다.
//
// ⚠️ Sidebar(서버 컴포넌트)는 NavProvider의 children으로 그대로 통과한다.
//    서버에서 이미 그려진 결과가 내려오므로, 이 파일 때문에 사이드바가 클라이언트로
//    바뀌거나 DB 조회가 브라우저로 새는 일은 없다.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type NavState = { open: boolean; setOpen: (v: boolean) => void };
const NavCtx = createContext<NavState | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 메뉴를 골라 화면이 바뀌면 서랍은 자동으로 닫는다(닫기를 또 누르게 하지 않는다).
  //  ⚠️ useEffect로 닫지 않는다 — 서랍이 열린 채 한 번 그려진 뒤에 다시 그려져 깜빡인다.
  //     React 권장 방식(렌더 중 상태 보정): 직전 주소를 같이 들고 있다가 주소가 바뀐 그 렌더에서 닫는다.
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setOpen(false);
  }

  // 열려 있는 동안: ESC로 닫기 + 뒤 본문 스크롤 잠금 + 뒤 본문 조작 차단 + 포커스 이동.
  //  ⚠️ 잠금·비활성은 서랍이 닫히거나 화면을 벗어날 때 정리(cleanup)에서 반드시 되돌린다.
  //  ⚠️ inert(본문 비활성)를 거는 이유: 서랍이 열려 있어도 Tab 키로는 뒤에 가려진 본문 버튼
  //     (로그아웃·삭제 등)까지 갈 수 있고 Enter로 눌러진다. 뒷배경은 마우스만 막는다(검수 중간 5).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // 스크롤 잠금은 **CSS 클래스**로 건다(직접 style.overflow를 만지지 않는다).
    //  ⚠️ 이유: 서랍을 연 채 창이 넓어지면 서랍·닫기버튼이 CSS로 사라지는데, 그때 잠금이 남으면
    //     화면이 스크롤도 안 되고 닫을 방법도 없는 상태가 된다(검수 중간 2).
    //     클래스 + @media(≤900px) 조합이면 넓어지는 순간 잠금이 **저절로** 풀린다(아래 matchMedia가
    //     혹시 동작하지 않아도 안전). globals.css의 `body.nav-locked`와 짝이다.
    document.body.classList.add("nav-locked");
    const main = document.querySelector(".app-main");
    main?.setAttribute("inert", "");
    // 서랍 첫 메뉴로 포커스를 옮긴다(화면낭독기·키보드 사용자가 서랍 안에서 시작하도록).
    (document.querySelector(".rail .rail-item") as HTMLElement | null)?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("nav-locked");
      main?.removeAttribute("inert");
      (document.querySelector(".nav-open-btn") as HTMLElement | null)?.focus();
    };
  }, [open]);

  // 🔴 열어 둔 채로 화면이 넓어지면(태블릿 가로 회전·창 넓히기) CSS가 [☰]·[✕]·뒷배경을 모두
  //    숨겨 버려, 닫을 방법이 화면에서 사라지고 본문 스크롤만 잠긴 채 남는다(검수 중간 2).
  //    → 서랍이 사라지는 폭(901px 이상)이 되면 상태도 같이 닫는다.
  //    ⚠️ 이 901은 globals.css의 @media (max-width: 900px)와 짝이다. 한쪽만 바꾸면 다시 갇힌다.
  useEffect(() => {
    if (!open) return;
    //  ※ "열 때 이미 넓은 경우"는 따로 막지 않는다 — [☰] 자체가 ≤900px에서만 보이므로
    //     넓은 화면에서는 애초에 열 수 없다(여기서 상태를 바꾸면 렌더가 두 번 돈다).
    const mq = window.matchMedia("(min-width: 901px)");
    const closeIfWide = () => {
      if (window.innerWidth > 900) setOpen(false);
    };
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    // 안전장치: 위 알림이 어떤 이유로든 오지 않아도, 화면을 한 번 누르면 원래대로 돌아온다.
    //  (스크롤 잠금은 CSS라 저절로 풀리지만, 본문 비활성(inert)은 이 코드가 풀어야 한다.)
    document.addEventListener("pointerdown", closeIfWide);
    return () => {
      mq.removeEventListener("change", onChange);
      document.removeEventListener("pointerdown", closeIfWide);
    };
  }, [open]);

  return (
    <NavCtx.Provider value={{ open, setOpen }}>
      <div
        className={open ? "app-row nav-open" : "app-row"}
        // 지금 보고 있는 화면과 같은 메뉴를 누르면 주소가 안 바뀌어 위 자동 닫힘이 걸리지 않는다.
        // 서랍 안 링크를 누른 경우엔 여기서 직접 닫는다(열려 있을 때만 동작).
        onClick={open ? (e) => { if ((e.target as HTMLElement).closest(".rail a")) setOpen(false); } : undefined}
      >
        {children}
        {open && (
          <>
            {/* 뒷배경 — 탭하면 닫힘. PC 화면에서는 CSS가 아예 안 보이게 한다. */}
            <button type="button" className="nav-backdrop" aria-label="메뉴 닫기" onClick={() => setOpen(false)} />
            <button type="button" className="nav-close" aria-label="메뉴 닫기" title="메뉴 닫기" onClick={() => setOpen(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </>
        )}
      </div>
    </NavCtx.Provider>
  );
}

/** 상단바 왼쪽 [☰] 버튼. 폰(≤900px)에서만 보인다(보이고 숨기는 건 globals.css). */
export function NavOpenButton() {
  const ctx = useContext(NavCtx);
  if (!ctx) return null; // NavProvider 밖에서 잘못 쓰면 조용히 아무것도 안 그린다(화면이 깨지지 않게).
  return (
    <button
      type="button"
      className="nav-open-btn"
      aria-label="메뉴 열기"
      aria-expanded={ctx.open}
      title="메뉴 열기"
      onClick={() => ctx.setOpen(true)}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}
