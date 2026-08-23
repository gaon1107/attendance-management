// 접이식 도움말 — 표 위아래의 긴 설명을 "핵심 한 줄 + 접힌 상세"로 만든다. (2026-08-23 신설)
//
// 왜 만들었나: 리포트·초과근무·연차정산 같은 화면에 4~6줄짜리 회색 문단이 붙어 있어
//   "개발자 메모가 화면에 그대로 나온" 느낌이었다(2026-08-23 디자인 검토).
//   ⚠️ 그렇다고 **내용을 지우면 안 된다.** 계산식·법 설명이라 지우면 근거가 사라진다.
//   그래서 지우는 대신 **접는다** — 핵심 한 줄은 화면에 남기고, 나머지는 눌러야 펼쳐진다.
//
// 쓰는 법:
//   <HelpNote title="계산 기준 자세히">
//     <p>...원래 설명 그대로...</p>
//   </HelpNote>
//
// ⚠️ `<details>`를 쓰므로 **자바스크립트 없이 동작**한다(서버 컴포넌트에서 그대로 쓸 수 있다).
//    이 프로젝트의 랜딩 FAQ도 같은 방식이다. 다만 CSS 클래스 이름은 겹치지 않게 나눠 뒀다
//    (`help-note` vs `landing-faq`) — globals.css에 그 이유가 적혀 있다.
// ⚠️ 여는 화살표를 돌리는 CSS는 globals.css의 `details.help-note`에 있다.
//    globals.css를 고치면 `.next`를 지우고 서버를 다시 띄워야 반영된다.
import type { ReactNode } from "react";
import { Icon } from "@/app/components/Icon";

export function HelpNote({
  title,
  children,
  /** 처음부터 펼쳐 둘지. 기본은 접힘 — 꼭 읽어야 하는 내용이면 요약 줄에 쓰고 여기 넣지 말 것. */
  defaultOpen = false,
  style,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <details className="help-note" open={defaultOpen} style={{ marginTop: 10, ...style }}>
      <summary
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          // ⚠️ fontSize를 못 박지 않는다 — 부모 문단이 12px인 화면(보안>이상접속)에서 글자만 커진다.
          fontWeight: 700,
          color: "var(--text-sub)",
          padding: "6px 10px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--card)",
          // 한글이 글자 중간에서 끊기지 않게(프로젝트 공통 규칙)
          wordBreak: "keep-all",
        }}
      >
        <Icon name="help" size={14} />
        {title}
        <span className="help-chevron" style={{ display: "inline-flex" }}>
          <Icon name="chevron" size={14} />
        </span>
      </summary>
      <div
        style={{
          color: "var(--text-sub)",
          lineHeight: 1.7,
          marginTop: 10,
          padding: "12px 14px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          wordBreak: "keep-all",
        }}
      >
        {children}
      </div>
    </details>
  );
}
