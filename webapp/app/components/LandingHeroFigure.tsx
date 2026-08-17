"use client";

// 홈화면(랜딩) 히어로의 3D 일러스트 — **움직임 때문에만** 클라이언트 컴포넌트다.
// (page.tsx는 서버 컴포넌트라 마우스 위치를 읽을 수 없다. 그림 한 장만 여기로 떼어 냈다.)
//
// 넣은 움직임 두 가지 (2026-08-17 사장님 확정)
//   ① 등장 — 페이지가 열릴 때 아래에서 한 번 떠오른다(CSS `landing-hero-rise`, 1.4초, 1회).
//   ② 바라보기 — 그 뒤로는 **화면 어디에 있든** 마우스 방향으로 최대 14° 기울고, 마우스가 멈추면
//      그 방향 그대로 **고정**된다. 정면으로 돌아오는 것은 **스크롤로 그림이 화면을 벗어날 때뿐이다.**
//      ※ 처음에는 그림 상자 안에서만 따라가고 벗어나면 곧바로 정면으로 튕겨 돌아왔는데,
//        사장님이 "마우스 방향으로 고정되게" 하라고 하셔서 추적 범위를 화면 전체로 넓혔다.
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
//    등장이 재생되는 1.4초 동안은 기울기를 쉬게 하고(entering), 끝나면 클래스를 떼어 되돌려준다.
import { useEffect, useRef, useState } from "react";

// 기울기 세기 — 그림 중앙이 0°, 상자 가장자리(그리고 그 밖 전부)가 ±7° = 끝에서 끝까지 14°.
// 여기 하나만 바꾸면 된다. 6°(미리보기) → 10° → 14°로 사장님이 실제 화면을 보며 올렸다.
// ⚠️ 이보다 더 키우면 그림이 종이처럼 휘어 보여 3D 일러스트의 입체감이 오히려 깨진다.
const TILT_MAX_DEG = 14;

export function LandingHeroFigure() {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [entering, setEntering] = useState(true);
  // 아래 마우스 리스너는 **한 번만** 등록하므로 그 안에서 state를 읽으면 첫 값에 갇힌다.
  // 그래서 리스너가 봐야 하는 값은 전부 ref로 따로 둔다.
  const enteringRef = useRef(true);
  const visibleRef = useRef(true);

  function finishEntering() {
    enteringRef.current = false;
    setEntering(false);
  }

  useEffect(() => {
    const box = boxRef.current;
    const img = imgRef.current;
    if (!box || !img) return;

    // 화면 움직임을 줄이도록 설정한 분(어지럼증 등)에게는 기울기를 걸지 않는다.
    // ⚠️ 이것만은 CSS `@media (prefers-reduced-motion)`로 막을 수 없다 — 기울기를 **인라인 style**로
    //    쓰기 때문에 CSS 규칙이 항상 진다. 그래서 여기서 직접 막는다(등장 쪽은 CSS가 막는다).
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 받침 — 브라우저가 animationend를 놓치거나(탭이 뒤에 있을 때 등) 동작 줄이기로 애니메이션이
    // 아예 없으면 이벤트가 오지 않는다. 그때 기울기가 영구히 잠기는 것을 막는다.
    // ⚠️ 이 2000ms는 globals.css의 등장 재생 시간(1.4초)보다 **넉넉히 길어야 한다.**
    //    먼저 울리면 애니메이션이 도중에 잘려 그림이 최종 위치로 툭 튄다. 둘은 짝이다.
    const timer = setTimeout(finishEntering, 2000);

    const tilt = (rx: number, ry: number) => {
      img.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    };

    // 정면 복귀는 여기 하나뿐 — **스크롤로 그림이 화면을 벗어날 때.**
    // 화면 밖에서는 마우스 계산도 멈춘다(보이지도 않는 그림 때문에 매 프레임 계산할 이유가 없다).
    // ⚠️ 좁은 화면(≤960px)에서는 globals.css가 이 그림을 `display: none`으로 감춘다. 그때 여기는
    //    항상 "안 보임"이 되어 아래 마우스 처리가 통째로 쉰다 — 터치 기기에서 헛일하지 않는다.
    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0].isIntersecting;
        if (!entries[0].isIntersecting) tilt(0, 0);
      },
      { threshold: 0 },
    );
    io.observe(box);

    // 마우스는 **화면 전체**에서 듣는다(그림 밖에서도 계속 바라보게 하려면 이 방법뿐이다).
    // ⚠️ mousemove는 초당 수십~수백 번 온다 → 그림 위치 계산은 화면 갱신 주기에 한 번만 한다.
    //    (여기서 매번 getBoundingClientRect를 부르면 브라우저가 레이아웃을 그만큼 다시 잰다)
    let last: { x: number; y: number } | null = null;
    let raf = 0;
    const apply = () => {
      raf = 0;
      if (!last) return;
      const r = box.getBoundingClientRect();
      if (!r.width || !r.height) return; // 감춰져 있으면 0이 온다 → 0으로 나누지 않는다
      // 그림 상자 기준 -0.5 ~ 0.5. 상자 **밖**은 범위를 넘으므로 잘라낸다
      // → 그림에서 멀어질수록 커지다가 가장자리 각도(±7°)에서 멈춘다 = "마우스 방향으로 고정".
      const clamp = (v: number) => (v < -0.5 ? -0.5 : v > 0.5 ? 0.5 : v);
      const x = clamp((last.x - r.left) / r.width - 0.5);
      const y = clamp((last.y - r.top) / r.height - 0.5);
      // 위쪽에 마우스가 있으면 위가 뒤로 눕는 방향(rotateX 부호가 반대)이라야 자연스럽다.
      tilt(Number((y * -TILT_MAX_DEG).toFixed(2)), Number((x * TILT_MAX_DEG).toFixed(2)));
    };
    const onMove = (ev: MouseEvent) => {
      if (reduce || enteringRef.current || !visibleRef.current) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    return () => {
      clearTimeout(timer);
      io.disconnect();
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={boxRef}
      className={entering ? "landing-hero-figure landing-hero-rise" : "landing-hero-figure"}
      // 자식 img의 애니메이션이 끝나면 여기로 올라온다(버블링).
      onAnimationEnd={finishEntering}
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
