// PWA 매니페스트 — "홈 화면에 추가" 시 앱처럼 동작하게 한다.
// 아이콘을 누르면 주소창 없이(standalone) 바로 출퇴근 화면(start_url)이 열린다.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "근태관리",
    short_name: "근태",
    description: "출퇴근을 한 번에 — 근태관리",
    start_url: "/attendance",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563EB",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
