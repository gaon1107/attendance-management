// 앱 아이콘(512x512, PNG 자동 생성) — 파란 배경 위 흰 시계 심볼.
// 한글 글꼴 의존을 피하려고 텍스트 대신 시계 SVG로 그린다(어디서나 동일하게 렌더).
import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#2563EB",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="300" height="300" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
