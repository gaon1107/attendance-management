import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InputAutoFormat } from "./components/InputAutoFormat";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  // 공유 미리보기 그림·대표 주소를 절대 주소로 만드는 기준(2026-11-23 검색 노출 기본 설정, lib/site.ts).
  metadataBase: new URL(SITE_URL),
  // 검색엔진 사이트 소유 확인 코드(공개값 — 페이지 소스에 그대로 보이는 값이라 비밀이 아니다). 지우면 등록이 풀린다.
  verification: {
    google: "VqNtSl2j1KaKCj9FMziAfvzNUR9ePuiKeid5OeRv_BI",
    other: { "naver-site-verification": "16aa9cde0751859bab844d4c748611dc9e92d90d" },
  },
  title: "근태관리",
  description: "정직한 실근무시간, 강제하지 않는 얼굴인증 — 중소기업 근태관리 SaaS",
  // iOS 홈 화면 추가 시 앱처럼(주소창 없이) 열리게 한다.
  appleWebApp: { capable: true, title: "근태관리", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#2563EB",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {/* 전역 입력 자동 서식(전화 하이픈·천단위 콤마) — 모든 페이지·신규 페이지에 자동 적용 */}
        <InputAutoFormat />
        {children}
      </body>
    </html>
  );
}
