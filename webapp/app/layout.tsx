import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "근태관리",
  description: "정직한 실근무시간, 강제하지 않는 얼굴인증 — 중소기업 근태관리 SaaS",
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
