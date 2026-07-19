// 공통 왼쪽 아이콘 사이드바 — 리뉴얼 디자인의 세로 네비게이션.
// 링크 구성은 역할별(관리자/직원)로 나뉜다. 아이콘 레일 형태의 세로 네비게이션.
import Link from "next/link";

type NavUser = {
  name: string;
  role: string;
  company: { name: string; logoName?: string | null; approvalMode?: string | null };
};

// 사이드바에서 현재 화면을 표시하기 위한 키.
export type NavKey =
  | "dashboard" | "notifications" | "employees" | "records" | "reports" | "biometrics"
  | "attendance" | "my-records" | "auth-method" | "settings" | "company"
  | "leave" | "leave-approvals" | "leave-summary" | "notice" | "corrections"
  | "security" // 보안로그(로그인 이력·접속 로그) — 관리자
  | "live" // 실시간 현황판(사무실 지도·근무 중·접속) — 관리자
  | "schedule" // 일정 캘린더(공휴일·휴무일·회사 일정) — 관리자
  | "shifts" // 근무표(교대 배정) — 관리자
  | "approvals" // 결재함(내 차례 결재) — 부서장 결재선 켠 회사만
  | "account"; // 계정 설정 — 사이드바 메뉴엔 없고(프로필 아바타로 진입) 하이라이트용 키

type Item = { key: NavKey; href: string; label: string; icon: string };

// lucide 스타일 아이콘(선). 목업과 동일한 모양.
const ICON: Record<NavKey, string> = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  employees: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><path d="M16 3.5a3 3 0 0 1 0 6"/>',
  records: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  biometrics: '<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  attendance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  "my-records": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  "auth-method": '<path d="M12 11a3 3 0 0 0-3 3v3"/><path d="M6 8a8 8 0 0 1 12 0"/><path d="M4 12a10 10 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M20 12a8 8 0 1 0-8 8"/><path d="M12 8v4l3 2"/>',
  company: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M13 9h.01M13 13h.01M13 17h.01"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  leave: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M9 14l2 2 4-4"/>',
  "leave-approvals": '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  notice: '<path d="M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a4 4 0 0 1 0 8"/>',
  corrections: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "leave-summary": '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h6"/>',
  security: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
  live: '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  schedule: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><rect x="7" y="13" width="4" height="4" rx="0.5"/>',
  shifts: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16"/>',
  approvals: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
};

const LABEL: Record<NavKey, string> = {
  dashboard: "대시보드",
  notifications: "알림",
  employees: "직원관리",
  records: "근태현황",
  reports: "리포트",
  biometrics: "생체정보",
  attendance: "출퇴근",
  "my-records": "내근태",
  "auth-method": "인증방식",
  settings: "설정",
  company: "회사정보",
  account: "계정",
  leave: "휴가",
  "leave-approvals": "휴가승인",
  notice: "공지",
  corrections: "정정",
  "leave-summary": "연차정산",
  security: "보안로그",
  live: "현황판",
  schedule: "일정",
  shifts: "근무표",
  approvals: "결재함",
};

// 화면 키 → 실제 경로(키와 경로가 다른 항목만 지정, 없으면 "/키")
const HREF: Partial<Record<NavKey, string>> = {
  "my-records": "/my-records",
  "leave-approvals": "/leave/approvals",
  security: "/security/logins", // 보안로그 진입점 = 로그인 이력 화면
};

// tintBg/tintText: 그룹 제목 칩의 연한 포인트 색(관리=파랑, 개인=초록으로 서로 구분)
type NavGroup = { caption: string; items: Item[]; tintBg?: string; tintText?: string };

function toItems(keys: NavKey[]): Item[] {
  return keys.map((key) => ({ key, href: HREF[key] ?? `/${key}`, label: LABEL[key], icon: ICON[key] }));
}

// 관리자 메뉴는 "회사관리"(직원들 것) 한 묶음. 관리자는 본인 출퇴근을 하지 않으므로 "내근태"(출퇴근·인증방식) 묶음은 제공하지 않는다.
// 직원 메뉴는 전부 본인 것이라 한 묶음(제목 없음).
function groupsFor(role: string, deptline: boolean): NavGroup[] {
  if (role === "admin") {
    // 결재선 켠 회사만 [결재함](관리자 오버라이드용)을 휴가승인 옆에 추가.
    const adminKeys: NavKey[] = ["dashboard", "notifications", "live", "employees", "records", "shifts", "schedule", "reports", "leave-approvals", ...(deptline ? (["approvals"] as NavKey[]) : []), "leave-summary", "biometrics", "security", "company", "settings"];
    return [{ caption: "회사관리", tintBg: "#E4EDFF", tintText: "#2563EB", items: toItems(adminKeys) }];
  }
  // 직원: 결재선 켠 회사면 [결재함](부서장이 자기 차례 승인)을 추가.
  const empKeys: NavKey[] = ["attendance", "my-records", "schedule", "leave", "corrections", ...(deptline ? (["approvals"] as NavKey[]) : []), "auth-method"];
  return [{ caption: "", items: toItems(empKeys) }];
}

export function Sidebar({ user, active }: { user: NavUser; active: NavKey }) {
  const groups = groupsFor(user.role, user.company.approvalMode === "deptline");
  const initial = user.name.slice(0, 1);

  return (
    <aside
      style={{
        width: 76,
        flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid var(--border)",
        // 화면 높이에 고정하고 자기 자리를 지킨다(길이가 긴 본문에서도 사이드바는 항상 보임).
        // 메뉴가 화면보다 길면 nav만 내부 스크롤 → 맨 아래 프로필과 겹치지 않는다.
        height: "100vh",
        position: "sticky",
        top: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
      }}
    >
      {/* 로고 — 회사 로고가 있으면 이미지, 없으면 "근" 글자([회사정보]에서 업로드) */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          background: user.company.logoName ? "#fff" : "var(--primary)",
          border: user.company.logoName ? "1px solid var(--border)" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 22,
          overflow: "hidden",
        }}
      >
        {user.company.logoName ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/company-logo?v=${encodeURIComponent(user.company.logoName)}`}
            alt={user.company.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>근</span>
        )}
      </div>

      {/* 메뉴 — 관리자는 "회사관리 / 내근태" 두 묶음으로 나눠 표시(구분선+작은 제목) */}
      {/* flex:1 + minHeight:0 + overflowY:auto → 화면이 낮아 메뉴가 넘칠 때만 내부 스크롤(맨 아래 프로필과 겹침 방지) */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", alignItems: "center", flex: 1, minHeight: 0, overflowY: "auto" }}>
        {groups.map((g, gi) => (
          <div
            key={g.caption || gi}
            style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", alignItems: "center" }}
          >
            {/* 두 번째 그룹부터는 앞에 구분선을 둔다 */}
            {gi > 0 && <div style={{ width: 44, height: 1, background: "var(--border)", margin: "10px 0 4px" }} />}
            {/* 그룹 제목(관리자만 있음) */}
            {g.caption && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.3,
                  marginTop: 2,
                  marginBottom: 4,
                  whiteSpace: "nowrap",
                  // 그룹 제목 배경 칩 — 관리(파랑)/개인(초록) 연한 포인트 색으로 또렷하게 구분(과하지 않게)
                  background: g.tintBg ?? "#E5E8EE",
                  color: g.tintText ?? "#4B5563",
                  padding: "3px 9px",
                  borderRadius: 7,
                }}
              >
                {g.caption}
              </span>
            )}
            {g.items.map((it) => {
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
          </div>
        ))}
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
