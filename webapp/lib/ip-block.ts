// 차단 IP 판정 — "이 IP는 로그인을 막아야 하나?"(접속/보안 5단계)
//
// 🛡️ 자기잠금(관리자가 스스로 못 들어오는 사고) 방어가 이 파일의 존재 이유다. 순서가 곧 안전장치다:
//   ① IP를 모르면 막지 않는다      — 오탐으로 멀쩡한 사람을 막는 것보다 낫다
//   ② 회사 허용 IP(사내망)는 통과  — 규칙에 뭘 넣든 **항상 이긴다**. 사무실에서는 절대 안 잠긴다
//   ③ 그 다음에야 차단 명단 검사
// ⚠️ ②를 ③보다 뒤로 옮기거나 빼면 관리자가 자기 사무실에서 잠길 수 있다. 순서를 바꾸지 말 것.
//
// 판정 규칙은 lib/ip.ts의 ipMatches를 그대로 재사용한다(사내망 판정·출퇴근 위치확인과 같은 규칙).
// → "1.2.3.4"=정확히 일치, "1.2.3"=1.2.3.* 대역 전체(마침표 경계까지만 인정).
import { prisma } from "@/lib/db";
import { ipMatches } from "@/lib/ip";

// 차단 규칙(화면·검사에서 공통으로 쓰는 최소 형태)
export type BlockRule = { pattern: string };

/**
 * 순수 판정 함수(DB 접근 없음) — 테스트·화면에서 그대로 쓸 수 있다.
 * @param ip        접속자 IP (모르면 null)
 * @param officeIps 회사 허용 IP 목록(CSV). 여기 맞으면 무조건 통과 = 자기잠금 방어
 * @param blocks    차단 규칙 목록
 */
export function isIpBlocked(ip: string | null, officeIps: string | null | undefined, blocks: BlockRule[]): boolean {
  if (!ip) return false; // ① IP를 모르면 막지 않는다
  if (ipMatches(ip, officeIps)) return false; // ② 사내망은 항상 이긴다 ← 순서 중요
  return blocks.some((b) => ipMatches(ip, b.pattern)); // ③ 차단 명단
}

/**
 * 회사 기준으로 차단 여부 조회(로그인 진입점용).
 * ⚠️ 조회가 실패하면 **막지 않는다**(false) — 보안장치 고장이 로그인 전체를 마비시키면 안 된다.
 *    차단은 "부가 방어"이고 본인 확인(비밀번호)은 그대로 동작한다.
 */
export async function isBlockedForCompany(companyId: string, ip: string | null): Promise<boolean> {
  if (!ip) return false;
  try {
    // 차단 규칙부터 조회 — 대부분의 회사는 규칙이 0건이라 여기서 끝난다(로그인마다 회사 조회 1회 절약).
    const blocks = await prisma.blockedIp.findMany({ where: { companyId }, select: { pattern: true } });
    if (blocks.length === 0) return false;

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { officeIps: true } });
    return isIpBlocked(ip, company?.officeIps ?? null, blocks);
  } catch (e) {
    console.warn("[ip-block] 차단 조회 실패(차단하지 않고 진행):", e);
    return false;
  }
}
