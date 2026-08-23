// 설정 화면 전환 탭 — [근무 규칙 | 출퇴근 인증 | 보안·PC]. (2026-08-23 신설)
//
// 왜 만들었나: 설정 9개가 한 페이지에 세로로 쌓여 **4,600px**(노트북 화면 5개 길이)이었고
//   [저장] 버튼이 9개라 "어디까지가 한 저장인지" 헷갈렸다(2026-08-23 디자인 검토).
//   실제로 얼굴 기준을 고치고 아래쪽 저장을 누르면 저장되지 않는다.
//
// 보안로그 화면의 `SecurityTabs`와 **모양을 똑같이** 맞췄다 — 같은 제품 안에서 탭이 두 가지로 보이면 안 된다.
//   다만 그쪽은 경로가 넷으로 나뉘어 있고(`/security/logins` 등), 설정은 한 경로라 **주소 뒤 값**(`?tab=`)으로 나눈다.
//
// ⚠️ 링크(`<a>`)만 쓴다 — 서버 컴포넌트에서 그대로 쓸 수 있고, 자바스크립트 없이도 동작한다.
//    새로고침해도 보던 탭이 유지되고, 특정 탭을 즐겨찾기 하거나 링크로 알려줄 수도 있다.

export const SETTINGS_TABS = [
  { key: "work", label: "근무 규칙", hint: "근무시간 · 공휴일 · 외출 사유" },
  { key: "auth", label: "출퇴근 인증", hint: "얼굴 기준 · 사내망 · 사업장 위치" },
  { key: "security", label: "보안·PC", hint: "이상접속 · PC-OFF" },
] as const;

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]["key"];

/** 주소에서 받은 값이 아는 탭인지 확인한다. 모르는 값이면 첫 탭으로. */
export function resolveTab(raw: string | undefined): SettingsTabKey {
  return SETTINGS_TABS.some((t) => t.key === raw) ? (raw as SettingsTabKey) : "work";
}

export function SettingsTabs({ active }: { active: SettingsTabKey }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      {SETTINGS_TABS.map((t) => {
        const on = t.key === active;
        return (
          <a
            key={t.key}
            href={`/settings?tab=${t.key}`}
            // title — 탭 이름만으로 어디에 있는지 모를 때 마우스를 올리면 안에 든 것이 보인다
            title={t.hint}
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
