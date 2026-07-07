import type { NextConfig } from "next";

// 모든 응답에 붙이는 웹 기본 보안 헤더.
// - X-Frame-Options: 다른 사이트가 우리 화면을 몰래 액자(iframe)에 넣어 클릭을 가로채는 공격(클릭재킹) 차단
// - X-Content-Type-Options: 브라우저가 파일 종류를 멋대로 추측(MIME 스니핑)하지 못하게 막음
// - Referrer-Policy: 다른 사이트로 이동할 때 우리 주소 정보를 최소한만 흘림
// - Permissions-Policy: 위치(GPS)·카메라(얼굴)는 우리 사이트에서만, 마이크는 아예 사용 안 함
// - Strict-Transport-Security: 배포(HTTPS) 시 항상 암호화 접속 강제(HTTP는 브라우저가 이 헤더를 무시하므로 개발엔 영향 없음)
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
