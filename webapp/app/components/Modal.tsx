"use client";
// 공용 알림/확인 팝업(다이얼로그) 뼈대 — 앱의 모든 "알림창"은 이걸 써서 형식을 통일한다.
//  · 왜: 승인 확인·반려 사유·공지·온보딩 등 팝업마다 중앙정렬 방식·모서리·여백·그림자가 제각각이라 통일.
//  · 중앙정렬: top/left 50% + translate(-50%,-50%). 게다가 createPortal로 <body> 맨 끝에 렌더하므로
//    표·카드 등 상위 요소에 transform/filter가 있어도 절대 밀리지 않는다(화면 정중앙 보장).
//  · 닫기: 배경(딤) 클릭 · 우상단 ✕ · ESC(escClose=false면 ESC 무시 — 온보딩 투어 등). 카드 클릭은 안 닫힘(배경과 형제라 버블 없음).
//  · 내용(children)은 호출부가 자유롭게. 여기선 배경·중앙 카드·제목줄·닫기만 표준으로 제공.
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

// 서버 렌더에선 false, 클라이언트 마운트 후 true. (effect 내 setState 없이 SSR-안전하게 클라 감지)
const subscribeNoop = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

export function Modal({
  open,
  onClose,
  title,
  maxWidth = 440,
  showClose = true,
  escClose = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;       // 있으면 상단 제목줄 표시(문자열/마크업 자유)
  maxWidth?: number;       // 카드 최대 폭(px). 좁은 화면은 92vw로 자동 축소.
  showClose?: boolean;     // 우상단 ✕ 노출(기본 true)
  escClose?: boolean;      // ESC로 닫기(기본 true). 온보딩 투어처럼 실수 종료를 막아야 하면 false.
  children: ReactNode;
}) {
  const isClient = useIsClient(); // 포털은 클라이언트에서만(서버엔 document 없음)

  useEffect(() => {
    if (!open || !escClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, escClose, onClose]);

  if (!open || !isClient) return null;

  return createPortal(
    <>
      {/* 딤 배경 — 클릭하면 닫힘 */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000 }} />
      {/* 중앙 카드(배경과 형제 → 카드 클릭은 배경으로 버블되지 않아 안 닫힘) */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: 1001,
          width: `min(${maxWidth}px, 92vw)`,
          maxHeight: "86vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          padding: 24,
        }}
      >
        {(title || showClose) && (
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.4, minWidth: 0, wordBreak: "keep-all" }}>{title}</div>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="닫기"
                style={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", color: "var(--text-sub)", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}
              >
                ✕
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}
