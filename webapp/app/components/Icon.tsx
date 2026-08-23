// 공용 선(線) 아이콘 — 화면 본문에서 이모지 대신 쓴다. (2026-08-23 신설)
//
// 왜 만들었나: 화면 곳곳에 이모지(🏢 🏠 🚗 📷 …)를 글자처럼 박아 뒀는데,
//   ① 윈도우·아이폰·안드로이드에서 **모양이 제각각**이고(윈도우는 납작한 컬러 이모지),
//   ② 왼쪽 메뉴(Sidebar)는 깔끔한 선 아이콘을 쓰는데 본문만 이모지라 **한 화면 안에 톤이 둘**이었다.
//   ③ "AI가 만든 화면" 인상의 가장 큰 원인이기도 했다(2026-08-23 디자인 검토).
//
// 규격은 **Sidebar.tsx의 ICON과 똑같이** 맞췄다(24×24 격자, 선 굵기 2, 끝은 둥글게).
//   → 사이드바와 본문 아이콘이 같은 집안처럼 보인다. 규격을 바꾸려면 두 곳을 함께 바꿀 것.
//
// 쓰는 법:
//   <Icon name="office" />                     // 글자 옆에 인라인으로 (기본 16px, 글자 기준선에 맞춰짐)
//   <Icon name="face" size={30} />             // 카드 위 큰 아이콘
//   <span style={{ color: "var(--success)" }}><Icon name="check" /></span>   // 색은 부모 글자색을 따라간다
//
// ⚠️ 색은 `stroke="currentColor"` 라 **부모의 글자색을 그대로 따른다.** 색을 따로 주려면 부모에 color를 준다.
// ⚠️ 장식용이라 `aria-hidden`이다. 아이콘만 있고 글자가 없는 버튼에는 반드시 `aria-label`을 따로 달 것.
import type { CSSProperties, ReactNode } from "react";

// 이름은 "무엇을 그린 그림인지"가 아니라 **어디에 쓰는지**로 짓는다(office = 사무실 출근).
export type IconName =
  | "office" // 사무실(건물) — 사무실 출근
  | "home" // 집 — 재택근무
  | "car" // 자동차 — 외근
  | "camera" // 카메라 — 촬영·사진
  | "edit" // 연필 — 근태 정정
  | "key" // 열쇠 — 비밀번호 재설정
  | "moon" // 달 — 야간·초과근무
  | "download" // 아래 화살표 — 엑셀 내보내기
  | "pin" // 지도 핀 — 위치·GPS
  | "clip" // 클립 — 첨부파일
  | "megaphone" // 확성기 — 공지
  | "bell" // 종 — 새 알림
  | "face" // 얼굴 — 얼굴인증
  | "exit" // 문 밖으로 — 외출/외근
  | "calendar" // 달력 — 날짜·기간 선택
  | "search" // 돋보기 — 검색(주소 찾기 등)
  | "printer" // 프린터 — 인쇄·PDF
  | "phone" // 휴대폰 — 홈 화면에 추가 안내
  | "check"; // 체크 — 완료·현재 사용 중

const PATHS: Record<IconName, ReactNode> = {
  office: (
    <>
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M9 9h.01M9 13h.01M9 17h.01M13 9h.01M13 13h.01M13 17h.01" />
    </>
  ),
  home: (
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  car: (
    <>
      <path d="M5 17h14M3 17v-4l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4" />
      <circle cx="7.5" cy="17" r="1.5" />
      <circle cx="16.5" cy="17" r="1.5" />
      <path d="M5 12h14" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 21 2M17 6l3 3M14 9l3 3" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 21h16" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  clip: <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10 17.9a1.7 1.7 0 0 1-2.4-2.4l8-8" />,
  megaphone: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  face: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01M15 10h.01" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    </>
  ),
  exit: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V3h12v6" />
      <path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="7" rx="1" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
};

export function Icon({
  name,
  size = 16,
  style,
}: {
  name: IconName;
  /** 그림 크기(px). 글자 옆에 쓸 땐 글자 크기보다 1~2px 작게 두면 자연스럽다. */
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      // ⚠️ display:inline-block 을 **반드시** 준다. Tailwind 기본 규칙(preflight)이
      //    `svg { display: block }` 으로 바꿔 버려서, 이게 없으면 아이콘이 **자기 혼자 한 줄을 차지**한다
      //    → 버튼 안에서 아이콘은 왼쪽 끝에, 글자는 가운데에 따로 놓인다(2026-08-23 실측으로 확인).
      // flexShrink:0 — 좁은 화면에서 글자에 밀려 아이콘이 찌그러지는 것을 막는다(모바일 검토 사례).
      // verticalAlign — 글자 옆에 놓았을 때 기준선에 걸치게 한다(안 주면 아이콘이 위로 뜬다).
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "-0.15em", ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
