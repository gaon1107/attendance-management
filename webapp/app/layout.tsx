import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InputAutoFormat } from "./components/InputAutoFormat";

export const metadata: Metadata = {
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
