// 보안로그 화면 전환 탭 — [로그인 이력 | 접속 로그].
//  · 사이드바 메뉴를 늘리지 않고 한 메뉴 안에서 두 화면을 오간다(기존 UI 유지).
//  · 서버 컴포넌트에서 그대로 쓸 수 있게 링크(<a>)만 사용한다.

const TABS = [
  { href: "/security/logins", label: "로그인 이력" },
  { href: "/security/access", label: "접속 로그" },
  { href: "/security/blocked", label: "차단 IP" },
];

export function SecurityTabs({ active }: { active: "logins" | "access" | "blocked" }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
      {TABS.map((t) => {
        // 정확히 일치로 판정 — endsWith면 "/security/xxx-access" 같은 경로가 생겼을 때 두 탭이 동시에 켜진다.
        const on = t.href === `/security/${active}`;
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
