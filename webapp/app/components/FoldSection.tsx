// 접이식 구역 — 화면 안에서 "가끔만 쓰는 묶음"을 접어 둔다. (2026-08-23 신설)
//
// 왜 만들었나: 직원 관리 화면은 **매일 보는 직원 목록이 맨 아래(1,500px 아래)**에 있고,
//   그 위를 부서·직급·초대·직접등록 네 묶음이 차지하고 있었다(2026-08-23 디자인 검토).
//   부서·직급은 회사를 처음 세팅할 때 한 번 정하고 거의 안 건드리는 값이라 접어 둔다.
//
// ⚠️ `HelpNote`와 헷갈리지 말 것 — 그쪽은 **작은 회색 부연 설명**이고, 이쪽은 **카드 여러 개를 담는 구역**이다.
//    모양이 비슷해 보여도 합치지 않는다(한쪽을 고칠 때 다른 쪽이 딸려 가면 안 된다).
//
// ⚠️ 접혀 있어도 **자식은 그대로 렌더된다**(브라우저가 감추기만 한다).
//    그래서 안에 든 서버 액션 폼·클라이언트 컴포넌트는 평소처럼 동작한다.
//    다만 접힌 글자는 브라우저 찾기(Ctrl+F)·인쇄에서 빠지므로, **꼭 봐야 하는 것은 넣지 않는다.**
//
// ⚠️ 펼쳐 둬야 할 상황이면 `defaultOpen`을 준다. 예) 아직 부서가 하나도 없는 회사,
//    방금 만든 초대 링크가 살아 있는 경우 — 접혀 있으면 사용자가 결과를 못 본다.
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/app/components/Icon";

export function FoldSection({
  title,
  hint,
  icon = "settings",
  children,
  defaultOpen = false,
}: {
  title: string;
  /** 제목 옆 한 줄 설명(선택). 무엇이 들어 있는지 접힌 채로 알 수 있게 한다. */
  hint?: string;
  icon?: IconName;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="fold-section" open={defaultOpen} style={{ marginBottom: 16 }}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "16px 20px",
          wordBreak: "keep-all",
        }}
      >
        <Icon name={icon} size={17} style={{ color: "var(--text-sub)" }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</span>
        {hint && (
          <span style={{ fontSize: 13, color: "var(--text-sub)", fontWeight: 400 }}>{hint}</span>
        )}
        {/* marginLeft:auto — 꺾쇠를 오른쪽 끝으로 밀어 "여기를 누르면 펼쳐진다"를 알린다 */}
        <span className="fold-chevron" style={{ marginLeft: "auto", display: "inline-flex", color: "var(--text-sub)" }}>
          <Icon name="chevron" size={18} />
        </span>
      </summary>
      <div style={{ marginTop: 16 }}>{children}</div>
    </details>
  );
}
