import type { Metadata, Viewport } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
