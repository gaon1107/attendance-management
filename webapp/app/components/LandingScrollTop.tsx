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
        // 디자인 — 2026-08-17 사장님이 보내주신 시안(민트색 둥근 네모 + 이중 꺾쇠 + TOP 글자)에 맞췄다.
        //   1차: 흰 원 + 회색 꺾쇠(푸터에 박혀 있어 거의 안 보였다)
        //   2차: 파란 그라데이션 원(히어로 버튼과 같은 톤)
        //   3차(지금): 민트색 둥근 네모 + 이중 꺾쇠 + TOP  ← 시안
        // ⚠️ 글자("TOP")가 들어가서 원이 아니라 **네모**여야 한다. 원으로 되돌리면 글자 자리가 없다.
        // ⚠️ 모서리 반경 12px은 시안의 비율(네모 한 변의 약 22%)을 56px에 맞춰 계산한 값이다.
        //    반경을 키우면 원에 가까워져 시안과 달라진다.
        width: 56,
        height: 56,
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        // ⚠️ 이 홈화면은 파란색 계열인데 이 버튼만 민트색이다 — **일부러 그렇다**(사장님 시안).
        //    본문과 색이 달라야 화면 위에 떠 있는 도구라는 것이 한눈에 읽힌다.
        background: hovered ? "#33B78D" : "#3FC79A",
        color: "#fff",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        // 마우스를 올리면 살짝 커지며 그림자가 진해진다.
        // ⚠️ 위로 띄우기(translateY)를 쓰지 않는 이유는 globals.css의 카드 규칙과 같다 — 버튼이 올라가면
        //    반응 영역도 같이 올라가서 커서가 아래 가장자리에 있을 때 화면이 덜덜 떨린다.
        transform: hovered ? "scale(1.08)" : "scale(1)",
        boxShadow: hovered ? "0 14px 32px rgba(45,175,133,0.48)" : "0 8px 22px rgba(45,175,133,0.35)",
        // 나타날 때/사라질 때 부드럽게. 안 보일 때는 클릭도 막는다(pointerEvents).
        opacity: shown ? 1 : 0,
        pointerEvents: shown ? "auto" : "none",
        transition: "opacity .2s ease, transform .18s ease, box-shadow .18s ease, background-color .18s ease",
      }}
    >
      {/* 이중 꺾쇠(위) — 시안처럼 꺾쇠 두 개를 겹쳐 "위로 쭉"이라는 뜻을 강하게 준다.
          ⚠️ 화면낭독기는 위 aria-label("맨 위로")만 읽으면 되므로 그림과 글자는 모두 aria-hidden이다.
             (안 그러면 "맨 위로 TOP"처럼 두 번 읽힌다) */}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 13 7-7 7 7" />
        <path d="m5 19 7-7 7 7" />
      </svg>
      <span aria-hidden style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", lineHeight: 1 }}>TOP</span>
    </button>
  );
}
