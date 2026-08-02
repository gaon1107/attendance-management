// 접속 IP 확인 도구.

// .get(name)을 가진 헤더 객체(next/headers의 headers() 반환값, 표준 Headers 모두 해당)
type HeaderLike = { get(name: string): string | null };

// ⚠️ [검수 H-1] x-forwarded-for는 **접속자가 마음대로 넣을 수 있는 헤더**다.
//   앞단에 우리가 세운 프록시(Nginx/IIS 등)가 있을 때만 믿을 수 있다.
//   프록시가 없는데 이 값을 믿으면, 집에 있는 직원이 헤더에 회사 IP를 적어 보내
//   "사무실 출근"으로 인증되고, 차단한 IP도 값만 바꿔 우회할 수 있다.
//
//   그래서 **.env의 TRUST_PROXY=1이 켜져 있을 때만** 이 헤더를 신뢰한다(기본은 꺼짐).
//   운영 배포 시 프록시를 두고 이 값을 켜면 된다 — docs/09_test/배포전_체크리스트.md 참고.
function trustProxyHeaders(): boolean {
  return process.env.TRUST_PROXY === "1";
}

// 요청 헤더에서 클라이언트(접속자) IP를 뽑는다. 프록시/서버 뒤에서는 x-forwarded-for에 담긴다.
// 기록·표시용. 프록시를 신뢰하지 않는 설정이면 위조 가능한 헤더는 쓰지 않는다.
export function getClientIp(h: HeaderLike): string | null {
  if (!trustProxyHeaders()) return null;
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xr = h.get("x-real-ip");
  if (xr) return xr.trim();
  return null;
}

// ※ 이 함수 하나만 쓰면 되도록 위에서 이미 막았다.
//   프록시를 신뢰하지 않는 설정에서는 어디서든 null이 되어,
//   사무실 IP 판정은 "확인 불가"로 남을 뿐 위조된 값으로 "확인됨"이 되지 않는다.
//   접속기록의 IP 칸도 비게 되는데, 이는 "모르는 것을 아는 척하지 않는" 쪽이 안전하다는 판단이다.

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
