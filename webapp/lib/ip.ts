// 접속 IP 확인 도구.

// .get(name)을 가진 헤더 객체(next/headers의 headers() 반환값, 표준 Headers 모두 해당)
type HeaderLike = { get(name: string): string | null };

// 요청 헤더에서 클라이언트(접속자) IP를 뽑는다. 프록시/서버 뒤에서는 x-forwarded-for에 담긴다.
export function getClientIp(h: HeaderLike): string | null {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xr = h.get("x-real-ip");
  if (xr) return xr.trim();
  return null;
}

// IP가 회사 허용목록(쉼표 구분)에 맞는지.
// 매칭 규칙(경계 안전): ① 정확히 같으면 통과. ② "대역"은 마침표(.) 경계까지만 인정한다.
//   예) 등록 "203.0.113"(또는 "203.0.113.") → 203.0.113.* 전체 통과, 하지만 203.0.1130 은 불통.
//   예) 등록 "1.2.3.4" → 1.2.3.4 만 통과. 예전처럼 1.2.3.45 가 잘못 통과하던 문제를 막는다.
export function ipMatches(ip: string | null, allowedCsv: string | null | undefined): boolean {
  if (!ip || !allowedCsv) return false;
  const rules = allowedCsv.split(",").map((s) => s.trim()).filter(Boolean);
  return rules.some((raw) => {
    const rule = raw.replace(/\.+$/, ""); // 끝의 마침표 정리("203.0.113." == "203.0.113")
    if (!rule) return false;
    // 정확히 일치하거나, "규칙." 으로 시작(마침표 경계)해야 대역으로 인정
    return ip === rule || ip.startsWith(rule + ".");
  });
}
