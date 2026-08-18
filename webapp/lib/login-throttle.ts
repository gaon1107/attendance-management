// IP 단위 시도 제한 (검수 M-17·M-19) — "한 곳에서 쏟아지는 시도"를 막는다.
//
// 왜 필요한가
//  · 지금은 **계정 단위 5회 잠금**만 있다. 그래서 공격자가 계정을 바꿔가며 두드리면(id 1000개 × 비번 3개)
//    아무 계정도 잠기지 않고 시도가 무제한이다. 계정 잠금은 "한 계정 지키기"고, 이건 "문 앞을 지키기"다.
//  · 회원가입·비밀번호 재설정 요청도 로그인 없이 무제한 호출된다. 가입은 국세청 사업자번호 조회 쿼터를
//    태우고, 재설정 요청은 관리자 화면을 대기 요청으로 가득 채운다.
//
// ⚠️ **작동 조건**: 접속자 IP는 `TRUST_PROXY=1`(.env)일 때만 읽힌다(lib/ip.ts).
//    앞단에 우리 프록시(Nginx 등)를 세우고 그 값을 켜기 전까지 이 파일의 모든 제한은 **아무 일도 하지 않는다.**
//    "켜져 있는 보안장치"가 아니라 "프록시를 세운 뒤에 작동하는 장치"다 — 배포 체크리스트에 필수 항목으로 둔다.
//    (프록시가 XFF 맨 앞을 접속자가 적은 값 그대로 넘기면 우회·사칭이 가능하다 — 덮어쓰기 설정이 함께 필요)
//
// 어떻게 세는가 — **새 표를 만들지 않는다.**
//  · 이미 모든 시도가 AccessEvent에 IP와 함께 남는다(login_fail 등). 그 기록을 그대로 센다.
//    → 스키마 변경 없음(색인만 추가), 관리자가 [보안]-[접속기록]에서 같은 데이터를 눈으로 확인할 수 있다.
//
// 오탐을 피하는 장치(이 순서가 곧 안전장치다)
//  · **비밀번호가 맞은 사람은 절대 막지 않는다** — 호출부(actions/auth.ts)가 비번 확인 뒤에만 차단한다.
//    사무실이 한 공인 IP를 함께 쓰므로, 옆자리 직원의 실패가 내 출근을 막으면 안 된다.
//  · 실패(login_fail)만 센다 — 차단 기록까지 세면 **스스로 창을 갱신해 영구 차단**이 된다(검수 치명 1).
//  · 회사가 등록한 사내망 IP(officeIps)는 면제한다(lib/ip-block.ts와 같은 철학).
//  · IP를 못 읽으면 제한하지 않는다 — 전 사용자를 막는 사고를 내지 않는다.
import { prisma } from "@/lib/db";
import { recordAccess } from "@/lib/access-log";
import { ipMatches } from "@/lib/ip"; // 사내망 판정 단일 출처(lib/ip-block.ts·출퇴근 위치확인과 같은 규칙)

// 로그인 실패: 10분 안에 같은 IP에서 이만큼 실패하면 잠시 거부한다.
//  · 사무실 공용 IP를 고려해 넉넉하게 잡았다(직원 20명이 각자 2번씩 틀려도 40회).
export const LOGIN_FAIL_WINDOW_MIN = 10;
export const LOGIN_FAIL_MAX_PER_IP = 50;

// 가입·비밀번호 재설정 요청: 사람이 정상적으로 이만큼 할 이유가 없다(1시간 기준).
export const SIGNUP_WINDOW_MIN = 60;
export const SIGNUP_MAX_PER_IP = 10;
export const RESET_WINDOW_MIN = 60;
export const RESET_MAX_PER_IP = 20;
// 가입 화면의 **사업자번호 즉시 확인**(app/api/bizreg-check): 국세청 조회 쿼터를 지킨다.
//  · 가입(10회)보다 넉넉한 이유: 오타를 고치며 여러 번 확인하는 것이 정상 사용이다.
//  · ⚠️ 형식이 틀린 값은 국세청에 묻지도 않으므로 **횟수를 세지 않는다**(호출부에서 순서로 보장).
export const BIZREG_CHECK_WINDOW_MIN = 60;
export const BIZREG_CHECK_MAX_PER_IP = 30;
// 비밀번호 찾기 인증번호 **오입력**: 같은 IP에서 이만큼 틀리면 잠시 거부한다.
//  · 코드 1건당 5회 상한은 이미 있지만, 그건 "코드 한 개"를 지킨다. 이건 "문 앞"을 지킨다.
//  · 세는 대상(reset_code_wrong)은 코드당 최대 5건만 생기므로 이 기록 자체가 적재 통로가 되지 않는다.
export const RESET_CODE_WINDOW_MIN = 60;
export const RESET_CODE_MAX_PER_IP = 30;

// 제한에 걸려 거부한 시도의 표시값. 이 표시가 붙은 기록은 **다시 세지 않는다**(자기 연장 방지).
export const THROTTLED_META = "login_ip_throttled";

// 거부 기록을 남기는 최소 간격 — 같은 IP·같은 사유는 이 시간 안에 1건만 남긴다.
//  · 안 두면 미인증 공격자가 **무제한으로 DB에 행을 쓸 수 있고**, 접속기록 화면(최신 2000건)에서
//    진짜 기록을 밀어내 사고 조사 증거를 지워버린다(검수 중간 2).
const LOG_DEDUPE_MIN = 1;

/**
 * 제한에 걸린 사실을 기록한다 — 단, 같은 IP·같은 사유는 1분에 1건만.
 * 감사 흔적은 남기되 적재 공격은 막는 절충안이다.
 */
export async function recordThrottleHit(input: {
  ip: string | null;
  kind: "login_fail" | "public_request";
  meta: string;
  companyId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  emailTried?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  if (!input.ip) return; // IP를 모르면 묶을 기준이 없다
  try {
    const recent = await prisma.accessEvent.count({
      where: { ip: input.ip, meta: input.meta, createdAt: { gte: since(LOG_DEDUPE_MIN, now) } },
    });
    if (recent > 0) return;
    await recordAccess({
      companyId: input.companyId ?? null,
      userId: input.userId ?? null,
      actorName: input.actorName ?? null,
      emailTried: input.emailTried ?? null,
      kind: input.kind,
      result: input.kind === "login_fail" ? "fail" : "blocked",
      ip: input.ip,
      userAgent: input.userAgent ?? null,
      meta: input.meta,
    });
  } catch (e) {
    console.warn("[login-throttle] 거부 기록 실패(본기능은 정상):", e);
  }
}

function since(minutes: number, now: Date): Date {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

/** 이 IP가 회사가 등록한 사내망인가 — 사내망이면 어떤 제한도 걸지 않는다(사무실 자기잠금 방지). */
async function isOfficeIp(companyId: string | null, ip: string | null): Promise<boolean> {
  if (!ip || !companyId) return false;
  try {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { officeIps: true } });
    return ipMatches(ip, company?.officeIps ?? null);
  } catch (e) {
    console.warn("[login-throttle] 사내망 조회 실패:", e);
    return false;
  }
}

/**
 * 로그인 시도를 지금 받아도 되는가.
 * @param companyId 이메일로 찾은 사용자의 회사(없으면 null — 사내망 면제를 적용할 수 없다)
 */
export async function loginAllowedForIp(ip: string | null, companyId: string | null, now: Date = new Date()): Promise<boolean> {
  if (!ip) return true; // IP를 모르면 제한하지 않는다(전면 차단 사고 방지)
  try {
    // 🔴 [검수 치명 1] **제한에 걸려 거부한 시도는 세지 않는다.**
    //    예전엔 그것까지 세어, 제한이 걸린 뒤의 시도가 전부 카운트를 갱신하며 **스스로 창을 연장**했다
    //    (진입 문턱=실패 50건인데 유지 문턱=아무 시도 50건 → 사무실에서 한 번 걸리면 영구 차단).
    //    ⚠️ `NOT`만 쓰면 meta가 비어 있는 행까지 함께 빠진다(SQL 3값 논리) — 반드시 OR로 감싼다.
    const fails = await prisma.accessEvent.count({
      where: {
        ip,
        kind: "login_fail",
        createdAt: { gte: since(LOGIN_FAIL_WINDOW_MIN, now) },
        OR: [{ meta: null }, { NOT: { meta: THROTTLED_META } }],
      },
    });
    if (fails < LOGIN_FAIL_MAX_PER_IP) return true;
    return await isOfficeIp(companyId, ip); // 임계치를 넘었어도 사내망이면 통과
  } catch (e) {
    // ⚠️ 세다가 실패하면 **막지 않는다**(lib/ip-block.ts와 같은 철학) — 보안 부가장치의 고장이
    //    로그인 전체를 마비시키면 안 된다. 본인 확인(비밀번호)은 그대로 동작한다.
    console.warn("[login-throttle] 시도 횟수 조회 실패(제한하지 않고 진행):", e);
    return true;
  }
}

/**
 * 로그인 없이 부를 수 있는 창구(가입·비밀번호 재설정)의 IP 제한.
 * 이 기록들은 companyId가 없을 수 있어(가입 전) 사내망 면제를 적용하지 않는다.
 * @param metaPrefix AccessEvent.meta 값("signup" | "reset_request" | "reset_code_wrong").
 *                  ⚠️ **정확일치**로 세므로 새 값을 넣을 때는 기록하는 쪽의 meta와 글자가 같아야 한다.
 */
export async function publicActionAllowedForIp(
  ip: string | null,
  metaPrefix: "signup" | "reset_request" | "reset_code_wrong" | "bizreg_check",
  max: number,
  windowMin: number,
  now: Date = new Date()
): Promise<boolean> {
  if (!ip) return true;
  try {
    const n = await prisma.accessEvent.count({
      // ⚠️ **정확일치**로 센다(검수 치명 1과 같은 함정) — startsWith면 "signup"이 "signup_blocked"까지 세어
      //    한 번 막힌 뒤 시도가 이어지는 한 창이 영원히 갱신된다.
      where: { ip, kind: "public_request", meta: metaPrefix, createdAt: { gte: since(windowMin, now) } },
    });
    return n < max;
  } catch (e) {
    console.warn("[login-throttle] 요청 횟수 조회 실패(제한하지 않고 진행):", e);
    return true;
  }
}
