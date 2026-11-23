// sitemap.xml — 검색엔진에 공개 페이지 목록을 알린다(2026-11-23 검색 노출 기본 설정).
//  로그인 없이 내용이 보이는 페이지만 넣는다(lib/site.ts PUBLIC_PATHS).
import type { MetadataRoute } from "next";
import { SITE_URL, PUBLIC_PATHS } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((p) => ({
    url: p === "/" ? SITE_URL : `${SITE_URL}${p}`,
    changeFrequency: p === "/" ? "weekly" : "monthly",
    priority: p === "/" ? 1 : 0.3,
  }));
}
