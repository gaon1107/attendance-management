"use client";

// 홈화면(랜딩)의 [맨 위로] 버튼 — 화면 오른쪽 아래에 **떠서 따라다니는** 버튼이다.
//
// 2026-08-17 사장님 지시로 이렇게 바뀌었다.
//   전: 푸터 안에 박혀 있어서 **맨 아래까지 내려가야** 보였고, 누르면 `href="#top"`으로 툭 점프했다.
//   후: 화면에 떠서 스크롤을 따라오므로 **언제든** 누를 수 있고, 부드럽게 올라간다. 디자인도 새로 했다.
//
// ⚠️ 스크롤 위치를 알아야 하므로 클라이언트 컴포넌트다(page.tsx는 서버 컴포넌트라 스크롤을 모른다).
// ⚠️ 히어로가 보이는 맨 위에서는 **숨긴다** — 이미 맨 위인데 [맨 위로]가 떠 있으면 군더더기다.
//    기준 480px은 히어로를 한 번 지나쳤다고 볼 수 있는 높이다(히어로가 화면 하나 정도를 차지한다).
import { useEffect, useState } from "react";

// 이 높이보다 더 내려가면 버튼이 나타난다.
const SHOW_AFTER_PX = 480;

export function LandingScrollTop() {
  const [shown, setShown] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    // ⚠️ scroll 이벤트는 초당 수십~수백 번 온다 → 화면 갱신 주기당 한 번만 계산한다.
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setShown(window.scrollY > SHOW_AFTER_PX);
      });
    };
    onScroll(); // 새로고침으로 중간에서 시작할 수도 있으니 지금 위치부터 한 번 본다
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const toTop = () => {
    // 화면 움직임을 줄이도록 설정한 분(어지럼증 등)에게는 부드러운 스크롤이 오히려 불편하다 → 즉시 이동.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="맨 위로"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // 화면에 고정 — 스크롤을 따라온다.
        position: "fixed",
        right: 24,
        // ⚠️ 24px → 88px 로 올렸다(2026-08-17 사장님 지시). 개발 서버에서 Next.js 개발용 표시(검은 "N"
        //    동그라미, 화면 오른쪽 맨 아래)와 겹쳐 보였기 때문이다. 그 표시는 실제 서비스에는 없지만,
        //    바닥에서 조금 떠 있는 편이 화면 모서리에 붙지 않아 눌리기도 쉽다.
        bottom: 88,
        // ⚠️ 헤더(z-index 10)보다 위에 둔다. 그래야 고정 헤더와 겹치는 순간에도 버튼이 가려지지 않는다.
        zIndex: 20,
        width: 50,
        height: 50,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        // 디자인 — 히어로의 [무료로 시작하기] 버튼과 같은 파란 그라데이션으로 톤을 맞췄다
        // (예전에는 흰 배경 + 회색 화살표라 푸터에서 거의 보이지 않았다).
        background: "linear-gradient(135deg,#2563EB,#3B82F6)",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // 마우스를 올리면 살짝 커지며 그림자가 진해진다.
        // ⚠️ 위로 띄우기(translateY)를 쓰지 않는 이유는 globals.css의 카드 규칙과 같다 — 버튼이 올라가면
        //    반응 영역도 같이 올라가서 커서가 아래 가장자리에 있을 때 화면이 덜덜 떨린다.
        transform: hovered ? "scale(1.08)" : "scale(1)",
        boxShadow: hovered ? "0 14px 32px rgba(37,99,235,0.45)" : "0 8px 22px rgba(37,99,235,0.32)",
        // 나타날 때/사라질 때 부드럽게. 안 보일 때는 클릭도 막는다(pointerEvents).
        opacity: shown ? 1 : 0,
        pointerEvents: shown ? "auto" : "none",
        transition: "opacity .2s ease, transform .18s ease, box-shadow .18s ease",
      }}
    >
      {/* 위쪽 화살표 — 선 하나를 더해(막대 + 꺾쇠) 예전 꺾쇠 하나보다 방향이 분명하다 */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V6" />
        <path d="m5.5 12.5 6.5-6.5 6.5 6.5" />
      </svg>
    </button>
  );
}
