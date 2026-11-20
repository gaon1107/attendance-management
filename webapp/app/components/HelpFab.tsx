"use client";
// 화면 오른쪽 아래에 **떠 있는 [도움말] 버튼** — 누르면 **지금 보고 있는 화면의 설명**이 창으로 뜬다.
//  (사장님 지시 2026-11-21: "홈화면 TOP 버튼처럼 로그인 후에도 오른쪽 아래에 도움말 버튼이 있으면 어떨까",
//                        "전체 사용법 말고 그 메뉴 사용법만 떴으면 좋겠다")
//
// 왜 새 탭이 아니라 **창(모달)**인가
//  · 새 탭으로 나가면 보던 목록·입력하던 내용을 잃어버린다. 도움말은 "보던 일을 하면서" 보는 것이다.
//  · 창 모양은 공용 Modal 을 그대로 쓴다 — 팝업마다 모양이 달라지지 않게(디자인 규칙 §5.7).
//
// ⚠️ 자리(오른쪽 24 · 아래 88)는 홈화면 [TOP] 버튼(LandingScrollTop)과 **같은 값**이다.
//    아래 24가 아니라 88인 이유: 개발 서버의 검은 "N" 표시가 오른쪽 맨 아래에 있어 겹친다(실서비스엔 없다).
// ⚠️ z-index 20 — 폰에서 메뉴 서랍(z-index 55·60)이 열리면 **그 아래로 가려져야** 한다. 20을 올리지 말 것.
import { useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import type { HelpEntry } from "@/lib/help-content";

export function HelpFab({ entry, guideHref }: { entry: HelpEntry; guideHref: string | null }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${entry.title} 도움말 열기`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "fixed",
          right: 24,
          bottom: 88,
          zIndex: 20,
          width: 56,
          height: 56,
          borderRadius: 12,
          border: "none",
          cursor: "pointer",
          // 홈 [TOP] 버튼과 같은 민트색 — 제품 안쪽은 파란 버튼이 많아, 떠 있는 도구는 색이 달라야 구분된다.
          background: hovered ? "#33B78D" : "#3FC79A",
          color: "#fff",
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          boxShadow: hovered ? "0 10px 24px rgba(0,0,0,0.22)" : "0 6px 16px rgba(0,0,0,0.16)",
          transition: "background 140ms, box-shadow 140ms",
        }}
      >
        {/* 화면낭독기는 위 aria-label 만 읽으면 되므로 그림과 글자는 숨긴다(두 번 읽히지 않게). */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.6v.4" />
          <path d="M12 17h.01" />
        </svg>
        <span aria-hidden style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.02em", lineHeight: 1 }}>도움말</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={`${entry.title} 사용법`} maxWidth={480}>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text)", wordBreak: "keep-all", margin: "0 0 14px" }}>
          {entry.intro}
        </p>

        {entry.items.length > 0 && (
          <ul style={{ margin: "0 0 18px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 9 }}>
            {entry.items.map((it) => (
              <li key={it} style={{ display: "flex", gap: 8, fontSize: 14, lineHeight: 1.6, color: "var(--text-sub)", wordBreak: "keep-all" }}>
                <span aria-hidden style={{ color: "var(--primary)", fontWeight: 700, flexShrink: 0 }}>·</span>
                <span>{it}</span>
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          {/* 그림까지 있는 자세한 설명이 안내서에 있는 화면만 이 버튼이 보인다. */}
          {guideHref && (
            <a
              href={guideHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 16px",
                borderRadius: 8, background: "var(--primary)", color: "#fff",
                fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              그림까지 자세히 보기
            </a>
          )}
          <a
            href="/help"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 14px",
              borderRadius: 8, background: "#fff", border: "1px solid var(--border)", color: "var(--text)",
              fontSize: 13, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
            }}
          >
            <Icon name="help" size={14} />전체 안내서
          </a>
        </div>
      </Modal>
    </>
  );
}
