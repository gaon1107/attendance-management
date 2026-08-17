// 운영자(본사) 백오피스 공통 껍데기 — 지금은 **검색엔진 차단**만 담당한다.
//
// 🔴 여기서 로그인 검사를 하지 않는다. Next의 layout은 page와 **나란히** 렌더되므로 layout이
//    막아도 page의 조회는 이미 돌 수 있다 = 방어가 되지 않는다. 그래서 로그인 검사는 반드시
//    **각 page.tsx 맨 위에서** getCurrentOperator()로 한다(저장소 관례와도 같다 — 고객사 화면들도
//    페이지 상단에서 getCurrentUser()를 부른다).
//
// ⚠️ 고객사 화면의 뼈대(AppShell·사이드바)를 쓰지 않는다. 그건 "로그인한 직원의 회사" 기준으로
//    메뉴·알림을 그리므로 소속 회사가 없는 운영자에게는 맞지 않는다.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "운영자 — 근태관리",
  // 검색엔진에 잡히면 안 된다. 이 문이 있다는 사실 자체를 광고할 이유가 없다.
  //  ※ 이것은 **보안이 아니라 위생**이다. 실제 방어는 로그인 검사·시도 제한·잠금이 한다.
  robots: { index: false, follow: false },
};

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
