// 공통 왼쪽 사이드바 — 다크 네이비 세로 네비게이션(2026-08-05 개편).
// 링크 구성은 역할별(관리자/직원)로 나뉜다. 아이콘(좌) + 메뉴명(우) 가로 배치.
//
// ⚠️ 이 파일은 **서버 컴포넌트**다(Prisma로 결재 대기 건수를 직접 조회한다).
//    그래서 "접기" 같은 클릭 상태를 컴포넌트가 들고 있을 수 없다.
//    → 접기 토글은 **작은 폼 + 서버 액션 + 쿠키**로 처리한다. 자바스크립트 없이 동작하고,
//      새로고침·화면 이동에도 접힘이 유지된다. 클라이언트 컴포넌트를 새로 만들지 않기 위한 선택이다.
import Link from "next/link";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { countMyPendingApprovals, isApprovalLineMember } from "@/lib/approval-server";

type NavUser = {
  id?: string;
  companyId?: string;
  name: string;
  role: string;
  /** 회사 계정(사람 아님)인가. 회사 계정에는 "내 근태" 묶음을 주지 않는다. */
  isOwner?: boolean;
  company: { name: string; logoName?: string | null; approvalMode?: string | null };
};

// 사이드바에서 현재 화면을 표시하기 위한 키.
export type NavKey =
  | "dashboard" | "notifications" | "employees" | "records" | "reports" | "biometrics"
  | "attendance" | "my-records" | "auth-method" | "settings" | "company"
  | "leave" | "leave-approvals" | "leave-summary" | "notice" | "corrections"
  | "outing" | "outing-approvals" // 외출/외근 신청(직원) · 승인(관리자)
  | "remote" | "remote-approvals" // 재택근무 신청(직원) · 승인(관리자)
  | "overtime" | "overtime-approvals" // 초과근무 사전신청(직원) · 승인(관리자)
  | "overtime-manage" // 초과근무 관리(관리자) — 주 단위 연장근로 현황 조회 전용
  | "break-time" // 휴게시간 관리(관리자) — 최소 휴게 기준 설정 + 준수 현황
  | "trip" | "trip-approvals" // 출장 신청(직원) · 승인(관리자)
  | "pc-devices" // PC관리(관리자) — PC-OFF 연결 기기 현황·예외자·사용 기록
  | "security" // 보안로그(로그인 이력·접속 로그) — 관리자
  | "live" // 실시간 현황판(사무실 지도·근무 중·접속) — 관리자
  | "schedule" // 일정 캘린더(공휴일·휴무일·회사 일정) — 관리자
  | "shifts" // 근무표(교대 배정) — 관리자
  | "approvals" // 결재함(내 차례 결재) — 부서장 결재선 켠 회사만
  | "pending-approvals" // 밀린 결재(관리자 전용) — 회사 전체 대기 중 결재를 모아 보고 대리 처리
  | "approval-history" // 결재 이력(관리자 전용) — 회사 전체 신청·승인·반려 조회
  | "account"; // 계정 설정 — 사이드바 메뉴엔 없고(프로필 아바타로 진입) 하이라이트용 키

type Item = { key: NavKey; href: string; label: string; icon: string };

// lucide 스타일 아이콘(선). 목업과 동일한 모양. ※ 이모지는 쓰지 않는다.
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
  "leave-approvals": '<rect x="2" y="4" width="13" height="12" rx="2"/><path d="M2 8h13M6 2v4M11 2v4"/><path d="M14 18l3 3 6-7"/>',
  notice: '<path d="M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a4 4 0 0 1 0 8"/>',
  corrections: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "leave-summary": '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h6"/>',
  "pc-devices": '<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M9 10l2 2-2 2"/>',
  security: '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
  live: '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  schedule: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><rect x="7" y="13" width="4" height="4" rx="0.5"/>',
  shifts: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16"/>',
  approvals: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  "pending-approvals": '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>',
  "approval-history": '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  outing: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  "outing-approvals": '<path d="M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4"/><path d="M12 6l4 4-4 4"/><path d="M16 10H7"/><path d="M14 18l3 3 6-7"/>',
  remote: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  "remote-approvals": '<path d="M2 8l7-6 7 6v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M7 17v-5h4v5"/><path d="M14 18l3 3 6-7"/>',
  overtime: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/><path d="M12 2v2M12 20v2"/>',
  "overtime-approvals": '<path d="M15 10.5A6.5 6.5 0 0 1 6.5 2 6.5 6.5 0 1 0 15 10.5z"/><path d="M14 18l3 3 6-7"/>',
  "overtime-manage": '<path d="M4 20V10M10 20V6M16 20v-9M22 20H2"/><circle cx="16" cy="6" r="2.5"/>',
  "break-time": '<path d="M4 9h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2"/><path d="M7 3v3M11 3v3"/>',
  trip: '<path d="M17.8 19.2 16 11l3.5-3.5a2.12 2.12 0 0 0-3-3L13 8 4.8 6.2a1 1 0 0 0-.9 1.7l4.6 3.1-2 3-2.5-.3-.9.9 3 1.5 1.5 3 .9-.9-.3-2.5 3-2 3.1 4.6a1 1 0 0 0 1.7-.9z"/>',
  "trip-approvals": '<path d="M2 9.5l14-5.5-3.5 6 3.5 6-14-5.5z"/><path d="M14 18l3 3 6-7"/>',
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
  "pc-devices": "PC관리",
  security: "보안로그",
  live: "현황판",
  schedule: "일정",
  shifts: "근무표",
  approvals: "결재함",
  "pending-approvals": "밀린 결재",
  "approval-history": "결재이력",
  outing: "외출외근",
  "outing-approvals": "외출승인",
  remote: "재택",
  "remote-approvals": "재택승인",
  overtime: "초과근무",
  "overtime-approvals": "야근승인",
  "overtime-manage": "초과근무관리",
  "break-time": "휴게시간",
  trip: "출장",
  "trip-approvals": "출장승인",
};

// 화면 키 → 실제 경로(키와 경로가 다른 항목만 지정, 없으면 "/키")
const HREF: Partial<Record<NavKey, string>> = {
  "my-records": "/my-records",
  "leave-approvals": "/leave/approvals",
  "outing-approvals": "/outing/approvals",
  "remote-approvals": "/remote/approvals",
  "overtime-approvals": "/overtime/approvals",
  "trip-approvals": "/trip/approvals",
  security: "/security/logins", // 보안로그 진입점 = 로그인 이력 화면
};

// 접을 수 있는 그룹의 id — **여기가 유일한 출처**다.
//  ⚠️ 새 그룹을 만들면 반드시 여기에 추가한다. 안 하면 tsc가 컴파일에서 막는다(검수 중간 3).
//     예전엔 이 목록과 groupsFor()가 따로 놀아서, 빠뜨리면 "제목은 보이는데 눌러도 아무 일도 안 나는"
//     조용한 고장이 났다(에러도 로그도 남지 않는다).
const GROUP_IDS = ["ops", "appr", "hr", "ana", "sec", "mine"] as const;
type ToggleableGroupId = (typeof GROUP_IDS)[number];
// "emp"(직원 한 묶음)는 제목이 없어 접기 대상이 아니다 — 접히면 링크가 0개인 화면이 된다.
type GroupId = ToggleableGroupId | "emp";

// id: 그룹 접기 상태를 쿠키에 기록할 때 쓰는 이름(사람이 보는 caption과 분리 — 제목이 바뀌어도 접힘이 풀리지 않게).
type NavGroup = { id: GroupId; caption: string; items: Item[] };

function toItems(keys: NavKey[]): Item[] {
  return keys.map((key) => ({ key, href: HREF[key] ?? `/${key}`, label: LABEL[key], icon: ICON[key] }));
}

// ── 접기 상태 쿠키 ────────────────────────────────────────────────────────
const COOKIE_RAIL = "sb_collapsed"; // "1"이면 64px 아이콘만
const COOKIE_GROUPS = "sb_groups"; // 접어 둔 그룹 id를 쉼표로 이어 둔 값
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1년

// 접기 토글(서버 액션) — 폼 전송으로 호출된다. 자바스크립트가 없어도 동작한다.
//  target="rail"이면 사이드바 전체 접기, 그 외에는 그룹 id.
//  ⚠️ 화면 데이터는 건드리지 않는다. 쿠키 하나만 쓰고 화면을 다시 그리게 한다.
async function toggleSidebar(formData: FormData): Promise<void> {
  "use server";
  const target = String(formData.get("target") ?? "").slice(0, 32);
  // 🔒 아는 이름만 받는다(검수 중간 1). 없으면 임의 문자열이 쿠키에 무한히 쌓여
  //    요청 헤더 한도를 넘고, 결국 로그인조차 안 되는 상태가 된다.
  if (target !== "rail" && !(GROUP_IDS as readonly string[]).includes(target)) return;
  const jar = await cookies();
  // httpOnly: 이 값은 서버만 읽으면 된다. 브라우저 스크립트가 못 건드리게 막아 두면
  //  "그룹을 전부 접어 링크가 하나도 없는 화면으로 만드는" 장난도 원천 차단된다.
  const opts = { path: "/", maxAge: COOKIE_MAX_AGE, sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };
  if (target === "rail") {
    jar.set(COOKIE_RAIL, jar.get(COOKIE_RAIL)?.value === "1" ? "0" : "1", opts);
  } else {
    const cur = new Set((jar.get(COOKIE_GROUPS)?.value ?? "").split(",").filter(Boolean));
    if (cur.has(target)) cur.delete(target);
    else cur.add(target);
    // 저장할 때도 아는 이름만 남긴다 — 읽을 때만 걸러내면 밖에서 심어진 값이 계속 따라다닌다(검수 경미 4).
    jar.set(COOKIE_GROUPS, [...cur].filter((x) => (GROUP_IDS as readonly string[]).includes(x)).join(","), opts);
  }
  // 사이드바는 **모든 화면**에 붙어 있으므로 레이아웃 단위로 다시 그린다.
  //  범위가 넓어 보이지만, 이게 없으면 이미 다녀온 다른 화면이 라우터 캐시에서 나올 때
  //  **접기 전 모습의 사이드바**가 그대로 보인다. 이 프로젝트엔 데이터 캐시를 쓰는 곳이
  //  한 군데도 없어(unstable_cache·"use cache"·revalidate 전부 0건) 지워질 캐시도 없다.
  revalidatePath("/", "layout");
}

// ── 메뉴 구성 ────────────────────────────────────────────────────────────
// 관리자 메뉴는 6묶음. **메뉴를 더하거나 빼지 않는다** — 기존 24개를 성격별로 나눠 담기만 한다.
//  · 2026-07-27 결정 유지: 관리자에게도 "내 근태"를 준다. 관리자도 근태 집계 대상이라
//    출근 버튼이 없으면 매일 [미출근]으로 뜨고, 휴가·정정이 없으면 연차 사용일수가 0으로 남는다.
//  · 🔒 회사 계정(isOwner)은 사람이 아니므로 "내 근태"를 주지 않는다.
// 직원 메뉴는 전부 본인 것이라 한 묶음(제목 없음 → 접기 대상도 아님).
// showApprovals: [결재함] 표시 여부. 결재 라인 구성원이거나 지금 내 차례가 있는 사람만 true.
function groupsFor(role: string, showApprovals: boolean, isOwner: boolean): NavGroup[] {
  if (role === "admin") {
    const groups: NavGroup[] = [
      { id: "ops", caption: "근태 운영", items: toItems(["dashboard", "records", "live", "shifts", "schedule"]) },
      {
        id: "appr",
        caption: "승인 관리",
        items: toItems([
          "leave-approvals", "overtime-manage", "outing-approvals", "remote-approvals",
          "overtime-approvals", "trip-approvals",
          ...(showApprovals ? (["approvals"] as NavKey[]) : []),
          "pending-approvals", "approval-history",
        ]),
      },
      { id: "hr", caption: "인사 정보", items: toItems(["employees", "notifications", "leave-summary"]) },
      { id: "ana", caption: "분석·설정", items: toItems(["reports", "break-time", "company", "settings"]) },
      { id: "sec", caption: "보안·기기", items: toItems(["biometrics", "pc-devices", "security"]) },
    ];
    if (!isOwner) {
      groups.push({ id: "mine", caption: "내 근태", items: toItems(["attendance", "my-records", "leave", "corrections", "auth-method"]) });
    }
    return groups;
  }
  const empKeys: NavKey[] = ["attendance", "my-records", "schedule", "leave", "corrections", "outing", "remote", "overtime", "trip", ...(showApprovals ? (["approvals"] as NavKey[]) : []), "auth-method"];
  return [{ id: "emp", caption: "", items: toItems(empKeys) }];
}

// 폭(펼침 220px / 접힘·좁은 화면 64px)은 globals.css의 .rail / .rail-fold에 있다.
export async function Sidebar({ user, active }: { user: NavUser; active: NavKey }) {
  // 다단계 결재를 쓰는 회사(부서장 자동 deptline · 상신자 지정 custom). single은 결재함 없음.
  const multiStep = user.company.approvalMode === "deptline" || user.company.approvalMode === "custom";
  const initial = user.name.slice(0, 1);
  // 다단계 결재 회사에서만 내 결재 대기 수를 배지로. 결재자 아니면 첫 쿼리에서 0(값싸다). single이면 조회 없음.
  const approvalWaiting = multiStep && user.companyId && user.id ? await countMyPendingApprovals(user.companyId, user.id) : 0;
  const showApprovals = multiStep && !!user.companyId && !!user.id && (approvalWaiting > 0 || (user.company.approvalMode === "deptline" && (await isApprovalLineMember(user.companyId, user.id))));
  const groups = groupsFor(user.role, showApprovals, !!user.isOwner);

  const jar = await cookies();
  const collapsed = jar.get(COOKIE_RAIL)?.value === "1";
  // ⚠️ 접은 그룹의 메뉴는 **DOM에는 그대로 두고 CSS로만 숨긴다.**
  //    서버는 화면 크기를 알 수 없는데, 좁은 화면·접힌 상태에서는 그룹 제목이 사라져
  //    다시 펼 방법이 없어지기 때문이다. CSS가 그때 도로 보여준다(메뉴가 영영 사라지는 함정 방지).
  //    제목이 없는 묶음(직원 화면)은 애초에 접기 대상이 아니다 — 접히면 링크가 0개가 된다(검수 중간 1).
  const closedGroups = new Set((jar.get(COOKIE_GROUPS)?.value ?? "").split(",").filter(Boolean));

  const roleLabel = user.role === "admin" ? "관리자" : "직원";

  return (
    <aside
      className={collapsed ? "rail rail-fold" : "rail"}
      style={{
        flexShrink: 0,
        background: "var(--rail)",
        // ⚠️ height/position/top은 **globals.css의 .rail**에 있다(인라인 금지).
        //    인라인 style은 CSS를 항상 이겨서, 폰(≤900px)에서 서랍(position:fixed)으로
        //    바뀌어야 하는 규칙이 통째로 먹히지 않는다. 화면 크기별 동작은 CSS만 할 수 있다.
        //    (기존 동작 그대로: 화면 높이에 고정 + sticky. 메뉴가 길면 nav만 내부 스크롤.)
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── 상단 56px: 로고 + 회사명 + 접기 토글 ──
          여백·정렬은 CSS(.rail-head)에 둔다 — 좁은 화면에서 아이콘 레일로 바뀌어야 하는데
          서버는 화면 크기를 모르기 때문이다(검수 치명 1). */}
      <div
        className="rail-head"
        style={{
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--rail-line)",
        }}
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: user.company.logoName ? "#fff" : "var(--primary)",
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
          }}
        >
          {user.company.logoName ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/company-logo?v=${encodeURIComponent(user.company.logoName)}`} alt={user.company.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ color: "#fff", fontSize: 15, fontWeight: 700 }}>근</span>
          )}
        </div>
        {!collapsed && (
          <>
            {/* 서비스명 = 실제 회사명 + " 근태"(하드코딩하지 않는다 — 회사마다 다르다).
                이름이 길면 말줄임되므로 title로 전체를 볼 수 있게 한다(검수 경미 4). */}
            <span className="rail-label" title={`${user.company.name} 근태`} style={{ flex: 1, minWidth: 0, color: "#fff", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.company.name} 근태
            </span>
            <form action={toggleSidebar} className="rail-toggle" style={{ flexShrink: 0 }}>
              <input type="hidden" name="target" value="rail" />
              <button type="submit" className="rail-btn" title="메뉴 접기" aria-label="메뉴 접기" style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
                <span style={{ width: 18, height: 18, display: "flex" }} dangerouslySetInnerHTML={{ __html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>' }} />
              </button>
            </form>
          </>
        )}
      </div>
      {collapsed && (
        <form action={toggleSidebar} className="rail-toggle rail-toggle-center" style={{ padding: "8px 0 0" }}>
          <input type="hidden" name="target" value="rail" />
          <button type="submit" className="rail-btn" title="메뉴 펼치기" aria-label="메뉴 펼치기" style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
            <span style={{ width: 18, height: 18, display: "flex" }} dangerouslySetInnerHTML={{ __html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>' }} />
          </button>
        </form>
      )}

      {/* ── 메뉴 ── flex:1 + minHeight:0 + overflowY:auto → 화면이 낮아 넘칠 때만 내부 스크롤 */}
      <nav className="rail-nav" style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 0" }}>
        {groups.map((g) => {
          // 제목이 없는 묶음(직원 화면)은 접힘 대상이 아니다 — 접히면 링크가 하나도 없는 화면이 된다.
          const closed = !!g.caption && closedGroups.has(g.id);
          return (
            <div key={g.id} className={closed ? "rail-group rail-group-closed" : "rail-group"}>
              {/* 그룹 제목 = 접기 버튼(우측에 옅은 구분선). 접힌 상태·좁은 화면·직원 화면에는 제목이 없다. */}
              {g.caption && (
                <form action={toggleSidebar} className="rail-capwrap">
                  <input type="hidden" name="target" value={g.id} />
                  <button
                    type="submit"
                    className="rail-cap"
                    aria-expanded={!closed}
                    title={closed ? `${g.caption} 펼치기` : `${g.caption} 접기`}
                    style={{ width: "100%", height: 36, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", fontSize: 11, fontWeight: 600, letterSpacing: 0.3, whiteSpace: "nowrap", fontFamily: "inherit", marginTop: 6 }}
                  >
                    <span>{g.caption}</span>
                    <span aria-hidden style={{ flex: 1, height: 1, background: "var(--rail-line)" }} />
                    <span
                      aria-hidden
                      style={{ width: 14, height: 14, display: "flex", transform: closed ? "rotate(-90deg)" : "none" }}
                      dangerouslySetInnerHTML={{ __html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' }}
                    />
                  </button>
                </form>
              )}
              {g.items.map((it) => {
                  const on = it.key === active;
                  return (
                    <Link
                      key={it.key}
                      href={it.href}
                      className={on ? "rail-item rail-item-on" : "rail-item"}
                      // 접힌 상태에서만 툴팁을 붙인다. 펼친 상태에선 글자가 이미 보이므로 같은 글자가
                      //  또 뜨면 거슬리고, 좁은 화면은 터치라 마우스오버 툴팁이 애초에 뜨지 않는다(검수 경미 5).
                      title={collapsed ? it.label : undefined}
                      // ⚠️ display/정렬은 CSS(.rail-item)에 둔다 — 인라인으로 두면 그룹 접기(display:none)를 이겨버린다.
                      style={{
                        position: "relative",
                        height: 42,
                        flexShrink: 0,
                        // 선택 표시용 왼쪽 3px 세로 바. 평소엔 투명으로 자리만 잡아 글자가 밀리지 않게 한다.
                        borderLeft: `3px solid ${on ? "var(--rail-bar)" : "transparent"}`,
                      }}
                    >
                      <span
                        style={{ width: 18, height: 18, flexShrink: 0, display: "flex" }}
                        dangerouslySetInnerHTML={{
                          __html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.icon}</svg>`,
                        }}
                      />
                      <span className="rail-label" style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                      {/* 결재함: 내 결재 대기 건수 배지 (접힘·좁은 화면에서는 CSS가 오른쪽 위로 옮긴다) */}
                      {it.key === "approvals" && approvalWaiting > 0 && (
                        <span
                          className="rail-badge"
                          style={{ background: "var(--danger)", color: "#fff", fontWeight: 800, lineHeight: 1 }}
                        >
                          {approvalWaiting}
                        </span>
                      )}
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {/* ── 하단 고정: 프로필(클릭 시 계정 설정) ──
          ※ 로그아웃 버튼은 상단바(AppShell)에 있다. 여기로 옮기면 AppShell을 고쳐야 해 이번 범위 밖이라
            같은 버튼이 두 개 생기지 않도록 두지 않았다. */}
      <div className="rail-profile" style={{ flexShrink: 0, borderTop: "1px solid var(--rail-line)" }}>
        <Link
          href="/account"
          className="rail-item rail-profile-link"
          title={`${user.name} (${roleLabel} · ${user.company.name}) · 계정 설정`}
          style={{ borderRadius: 8, height: 44 }}
        >
          <span
            style={{
              width: 32, height: 32, flexShrink: 0, borderRadius: "50%",
              background: "var(--rail-active)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
            }}
          >
            {initial}
          </span>
          {/* 색은 CSS(.rail-who/.rail-sub)로 준다 — 인라인 color를 두면 마우스를 올려도 밝아지지 않는다(검수 경미 3) */}
          <span className="rail-label rail-userbox">
            <span className="rail-who" style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</span>
            <span className="rail-sub" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {roleLabel} · {user.company.name}
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
