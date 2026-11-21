// [메시지 관리] 화면 전환 탭 — 사이드바 메뉴를 늘리지 않고 한 메뉴 안에서 여러 화면을 오간다.
//  · 서버 컴포넌트에서 그대로 쓸 수 있게 링크(<a>)만 쓴다(보안로그 SecurityTabs와 같은 방식).
//  · 차례는 학원관리와 같다: 보내기 → 기록 → 템플릿. [알림톡 관리]는 4단계에서 붙는다.

const TABS = [
  { key: "send", href: "/messages/sms/send", label: "메시지 발송" },
  { key: "logs", href: "/messages/sms/logs", label: "발송 기록" },
  { key: "templates", href: "/messages/sms/templates", label: "템플릿 관리" },
] as const;

export type MessageTabKey = (typeof TABS)[number]["key"];

export function MessageTabs({ active }: { active: MessageTabKey }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <a
            key={t.href}
            href={t.href}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap",
              color: on ? "var(--primary)" : "var(--text-sub)",
              borderBottom: on ? "2px solid var(--primary)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </a>
        );
      })}
    </div>
  );
}
