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

// IP가 회사 허용목록(쉼표 구분)에 맞는지. 정확히 같거나, 등록값으로 시작하면(대역) 통과.
export function ipMatches(ip: string | null, allowedCsv: string | null | undefined): boolean {
  if (!ip || !allowedCsv) return false;
  const rules = allowedCsv.split(",").map((s) => s.trim()).filter(Boolean);
  return rules.some((rule) => ip === rule || ip.startsWith(rule));
}
