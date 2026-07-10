import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "라이브니스 데모 — 사진 위조 판독 테스트",
  description: "MiniFASNet 기반 얼굴 위조(사진/화면) 판독 성능 검증용 데모",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "'Pretendard', 'Malgun Gothic', sans-serif", background: "#F9FAFB", color: "#111827" }}>
        {children}
      </body>
    </html>
  );
}
