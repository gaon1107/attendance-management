// robots.txt — 검색 로봇에게 읽어도 되는 곳을 알린다(2026-11-23 검색 노출 기본 설정).
//  · 공개 페이지(홈·약관·처리방침)는 열어 둔다. 챗GPT·퍼플렉시티 같은 AI 검색 로봇도 "*"에 포함된다.
//  · 운영자 화면·내부 주소·초대 링크(주소에 열쇠가 들어 있다)·결제 시험 화면은 막는다.
//    로그인 뒤 화면은 로봇이 들어와도 로그인 화면으로 돌려보내지므로 따로 적지 않는다.
//  ⚠️ robots.txt는 "부탁"일 뿐 잠금이 아니다 — 실제 보호는 각 화면의 로그인 검사가 한다.
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/operator", "/api/", "/invite/", "/kicc-test"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
