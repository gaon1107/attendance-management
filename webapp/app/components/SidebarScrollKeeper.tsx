"use client";
// 왼쪽 메뉴바(.rail-nav)의 스크롤 위치 유지 (2026-11-21 사장님 요청).
//
// 왜 필요한가: 메뉴바는 AppShell 안에 있어 **화면을 옮길 때마다 새로 그려진다.** 그래서 아래쪽 메뉴(예: [연차정산])를
//   누르면 다음 화면에서 메뉴바가 맨 위로 돌아가, 방금 누른 메뉴가 안 보였다.
//
// 동작
//  ① 메뉴바를 스크롤할 때마다 위치를 이 탭의 sessionStorage에 적어 둔다.
//  ② 새 화면이 뜨면 그 위치로 되돌린다(그려진 직후 — useLayoutEffect라 깜빡이지 않는다).
//  ③ 그래도 선택된 메뉴(.rail-item-on)가 메뉴바 밖이면 보이는 자리까지만 움직인다
//     (예: 다른 경로로 들어와 기억된 위치가 없을 때). scrollIntoView는 바깥 화면까지 움직일 수 있어 쓰지 않는다.
//  · 저장이 막힌 환경(사생활 보호 모드 등)에서는 조용히 넘어가고 예전처럼 맨 위에서 시작한다.
//  · 아무것도 그리지 않는다(return null). Sidebar.tsx(서버 컴포넌트)가 메뉴바 바로 뒤에 끼워 둔다.
import { useLayoutEffect } from "react";

const STORAGE_KEY = "sb_nav_scroll";
/** 선택된 메뉴를 끌어올 때 위아래로 남겨 둘 여유(px). 가장자리에 딱 붙지 않게. */
const MARGIN = 8;

export function SidebarScrollKeeper() {
  useLayoutEffect(() => {
    const nav = document.querySelector<HTMLElement>(".rail-nav");
    if (!nav) return;

    // ② 기억한 위치로
    try {
      const saved = Number(sessionStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) nav.scrollTop = saved;
    } catch {
      // 저장소를 못 쓰면 맨 위에서 시작(예전 동작)
    }

    // ③ 선택된 메뉴가 안 보이면 보이는 자리까지만
    const on = nav.querySelector<HTMLElement>(".rail-item-on");
    if (on) {
      const box = nav.getBoundingClientRect();
      const item = on.getBoundingClientRect();
      // 메뉴바가 화면에 안 그려진 상태(높이 0 — 좁은 화면에서 접힘 등)면 건드리지 않는다.
      if (box.height > 0 && item.height > 0) {
        if (item.top < box.top) nav.scrollTop -= box.top - item.top + MARGIN;
        else if (item.bottom > box.bottom) nav.scrollTop += item.bottom - box.bottom + MARGIN;
      }
    }

    // ① 스크롤할 때마다 기억
    const save = () => {
      try {
        sessionStorage.setItem(STORAGE_KEY, String(Math.round(nav.scrollTop)));
      } catch {
        // 무시
      }
    };
    save(); // ③에서 움직였으면 그 위치도 기억
    nav.addEventListener("scroll", save, { passive: true });
    return () => nav.removeEventListener("scroll", save);
  }, []);

  return null;
}
