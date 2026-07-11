import type { NextConfig } from "next";

// 연속 3장 촬영 전송용 — 서버 액션 본문 한도 상향 (기본 1MB → 4MB, 장당 최대 850KB × 3장 + 여유)
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
