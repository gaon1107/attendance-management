"use client";
// "홈 화면에 추가" 안내 — 아직 설치 안 했고(브라우저로 열림) 닫지 않았을 때만 작게 보여준다.
// 이미 홈 화면 앱(standalone)으로 열었거나 닫았으면 숨긴다.
import { useEffect, useState } from "react";

const DISMISS_KEY = "a2hs-hint-dismissed";

export function AddToHomeHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // 이미 홈 화면 앱으로 실행 중이면 안내 불필요
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari 전용 플래그
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    if (!standalone && !dismissed) setShow(true);
  }, []);

  if (!show) return null;

  function close() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10,
        padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "#1D4ED8",
      }}
    >
      <span style={{ flexShrink: 0, fontSize: 16 }}>📲</span>
      <span style={{ flex: 1, lineHeight: 1.5, fontWeight: 700 }}>
        브라우저 메뉴에서 <b>‘홈 화면에 추가’</b>를 누르면 앱처럼 한 번에 출퇴근할 수 있어요.
      </span>
      <button
        onClick={close}
        aria-label="닫기"
        style={{ flexShrink: 0, width: 26, height: 26, border: "none", borderRadius: 6, background: "transparent", color: "#1D4ED8", fontSize: 16, fontWeight: 700, cursor: "pointer" }}
      >
        ✕
      </button>
    </div>
  );
}
