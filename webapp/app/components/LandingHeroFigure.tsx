"use client";

// 홈화면(랜딩) 히어로의 3D 일러스트 — **움직임 때문에만** 클라이언트 컴포넌트다.
// (page.tsx는 서버 컴포넌트라 마우스 위치를 읽을 수 없다. 그림 한 장만 여기로 떼어 냈다.)
//
// 넣은 움직임 두 가지 (2026-08-17 사장님 확정, 미리보기로 고르셨다):
//   ① 등장 — 페이지가 열릴 때 아래에서 한 번 떠오른다(CSS `landing-hero-rise`, 0.9초, 1회).
//   ② 기울기 — 그 뒤로는 그림 위 마우스 방향으로 최대 6° 기운다.
//
// 🔴 **움직임은 반드시 그림(img) 자신에게만 건다.** 감싼 상자(.landing-hero-figure)에 transform·
//    perspective·z-index 같은 것을 주면 그 상자가 **별도 합성 칸**이 되고, 그러면 globals.css가
//    그림에 걸어 둔 `mix-blend-mode: multiply`(흰 바탕 지우기)가 히어로 배경까지 닿지 못해
//    **그림 뒤에 흰 네모가 드러난다.** 2026-08-17 미리보기에서 실제로 그렇게 만들어 사장님께 지적받았다.
//    → 그래서 원근감도 `perspective` 속성이 아니라 transform 안의 `perspective()` **함수**로 준다.
//
// ⚠️ 각도를 CSS 변수(var(--rx))로 넘기지 말 것 — 실제로 만들어 보니 원근감만 걸리고 **회전이 0에
//    머물렀다**(크롬 실측). 등록하지 않은 CSS 변수는 transition과 맞물릴 때 값 변화가 transform에
//    반영되지 않는다. 그래서 여기서 transform 문자열을 통째로 직접 써 준다.
//
// ⚠️ 등장과 기울기는 **같은 transform 속성을 다툰다.** CSS 애니메이션이 인라인 style을 이기므로
//    등장이 재생되는 0.9초 동안은 기울기를 쉬게 하고(entering), 끝나면 클래스를 떼어 되돌려준다.
import { useEffect, useRef, useState } from "react";

// 기울기 세기. 여기 하나만 바꾸면 된다.
// 2026-08-17: 미리보기에서 6°로 골랐으나 **실제 화면에서 보니 약하다**는 사장님 판단으로 10°로 올렸다.
//             (미리보기 상자가 실제 히어로보다 작아 같은 각도가 더 커 보였던 것으로 보인다)
const TILT_MAX_DEG = 10;

export function LandingHeroFigure() {
  const imgRef = useRef<HTMLImageElement>(null);
  // 화면 움직임을 줄이도록 설정한 분(어지럼증 등)에게는 기울기를 걸지 않는다.
  // ⚠️ 이것만은 CSS `@media (prefers-reduced-motion)`로 막을 수 없다 — 기울기를 **인라인 style**로
  //    쓰기 때문에 CSS 규칙이 항상 진다. 그래서 여기서 직접 막는다(등장 쪽은 CSS가 막는다).
  const reduceRef = useRef(false);
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 받침 — 브라우저가 animationend를 놓치거나(탭이 뒤에 있을 때 등) 동작 줄이기로 애니메이션이
    // 아예 없으면 이벤트가 오지 않는다. 그때 기울기가 영구히 잠기는 것을 막는다.
    // ⚠️ 이 2000ms는 globals.css의 등장 재생 시간(1.4초)보다 **넉넉히 길어야 한다.**
    //    먼저 울리면 애니메이션이 도중에 잘려 그림이 최종 위치로 툭 튄다. 둘은 짝이다.
    const t = setTimeout(() => setEntering(false), 2000);
    return () => clearTimeout(t);
  }, []);

  function tilt(rx: number, ry: number) {
    const img = imgRef.current;
    if (!img) return;
    img.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  }

  return (
    <div
      className={entering ? "landing-hero-figure landing-hero-rise" : "landing-hero-figure"}
      // 자식 img의 애니메이션이 끝나면 여기로 올라온다(버블링).
      onAnimationEnd={() => setEntering(false)}
      // 터치 기기에는 mousemove가 오지 않아 자동으로 아무 일도 하지 않는다.
      // (좁은 화면에서는 globals.css가 이 그림을 아예 감춘다)
      onMouseMove={(e) => {
        if (entering || reduceRef.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5; // -0.5 ~ 0.5
        const y = (e.clientY - r.top) / r.height - 0.5;
        // 위쪽에 마우스가 있으면 위가 뒤로 눕는 방향(rotateX 부호가 반대)이라야 자연스럽다.
        tilt(Number((y * -TILT_MAX_DEG).toFixed(2)), Number((x * TILT_MAX_DEG).toFixed(2)));
      }}
      onMouseLeave={() => {
        if (reduceRef.current) return;
        tilt(0, 0);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 크기가 고정된 장식용 그림. 최적화 대상 아님 */}
      <img
        ref={imgRef}
        src="/hero-person.webp"
        alt=""
        width={1279}
        height={854}
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
    </div>
  );
}
