// 공통 왼쪽 아이콘 사이드바 — 리뉴얼 디자인의 세로 네비게이션.
// 링크 구성은 역할별(관리자/직원)로 나뉜다. 아이콘 레일 형태의 세로 네비게이션.
import Link from "next/link";

type NavUser = {
  name: string;
  role: string;
  company: { name: string };
};

// 사이드바에서 현재 화면을 표시하기 위한 키.
export type NavKey =
  | "dashboard" | "employees" | "records" | "reports" | "biometrics"
  | "attendance" | "my-records" | "auth-method" | "settings"
  | "account"; // 계정 설정 — 사이드바 메뉴엔 없고(프로필 아바타로 진입) 하이라이트용 키

type Item = { key: NavKey; href: string; label: string; icon: string };

// lucide 스타일 아이콘(선). 목업과 동일한 모양.
const ICON: Record<NavKey, string> = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  employees: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><path d="M16 3.5a3 3 0 0 1 0 6"/>',
  records: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  biometrics: '<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  attendance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  "my-records": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  "auth-method": '<path d="M12 11a3 3 0 0 0-3 3v3"/><path d="M6 8a8 8 0 0 1 12 0"/><path d="M4 12a10 10 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M20 12a8 8 0 1 0-8 8"/><path d="M12 8v4l3 2"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
};

const LABEL: Record<NavKey, string> = {
  dashboard: "대시보드",
  employees: "직원관리",
  records: "근태현황",
  reports: "리포트",
  biometrics: "생체정보",
  attendance: "출퇴근",
  "my-records": "내근태",
  "auth-method": "인증방식",
  settings: "설정",
  account: "계정",
};

// 화면 키 → 실제 경로(키와 경로가 다른 항목만 지정, 없으면 "/키")
const HREF: Partial<Record<NavKey, string>> = {
  "my-records": "/my-records",
};

function itemsFor(role: string): Item[] {
  const keys: NavKey[] =
    role === "admin"
      ? ["dashboard", "employees", "records", "reports", "biometrics", "attendance", "auth-method", "settings"]
      : ["attendance", "my-records", "auth-method"];
  return keys.map((key) => ({ key, href: HREF[key] ?? `/${key}`, label: LABEL[key], icon: ICON[key] }));
}

export function Sidebar({ user, active }: { user: NavUser; active: NavKey }) {
  const items = itemsFor(user.role);
  const initial = user.name.slice(0, 1);

  return (
    <aside
      style={{
        width: 76,
        flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid var(--border)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
      }}
    >
      {/* 로고 */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          background: "var(--primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 22,
        }}
      >
        <span style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>근</span>
      </div>

      {/* 메뉴 */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", alignItems: "center" }}>
        {items.map((it) => {
          const on = it.key === active;
          return (
            <Link
              key={it.key}
              href={it.href}
              style={{
                width: 56,
                height: 50,
                borderRadius: 11,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                textDecoration: "none",
                background: on ? "#EFF6FF" : "transparent",
                color: on ? "var(--primary)" : "#9CA3AF",
              }}
            >
              <span
                style={{ width: 19, height: 19, display: "flex" }}
                dangerouslySetInnerHTML={{
                  __html: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.icon}</svg>`,
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 700 }}>{it.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 아래: 프로필(클릭 시 계정 설정) — 로그아웃은 상단바 우측 공통 버튼으로 이동 */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Link
          href="/account"
          title={`${user.name} (${user.role === "admin" ? "관리자" : "직원"}) · 계정 설정`}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#EEF2F7",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "#374151",
            textDecoration: "none",
          }}
        >
          {initial}
        </Link>
      </div>
    </aside>
  );
}
