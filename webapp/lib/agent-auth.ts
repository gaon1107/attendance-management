// PC 에이전트(설치형 앱) 전용 인증 — 브라우저 세션(lib/session.ts)과 완전히 분리된 별도 체계.
//  · 왜 분리하나: 설치형 앱은 브라우저가 아니라 쿠키를 쓸 수 없다. 그래서 "기기 토큰"을 헤더로 보낸다.
//  · 보안 원칙(사규 8조): 토큰 평문은 발급 순간 1회만 앱에 주고, DB에는 sha256 해시만 남긴다(비밀번호와 같은 원칙).
//  · ⚠️ 이 파일은 lib/session.ts를 건드리지 않는다. 브라우저 로그인 동작에 영향 0.
import { createHash, randomBytes, randomInt } from "crypto";
import { prisma } from "./db";

// ── 연결코드(페어링) 규칙 ──────────────────────────────────────────────
export const PAIR_CODE_TTL_MIN = 5; // 발급 후 유효 시간(분)
const PAIR_CODE_DIGITS = 6;

// ── 기기 토큰 ────────────────────────────────────────────────────────
// 32바이트 난수 → 64자 16진수 문자열. 세션 토큰과 같은 강도.
export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

// 토큰 → 저장용 해시. 같은 입력이면 항상 같은 값이라 조회(where)로 찾을 수 있다.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// 6자리 연결코드 생성. Math.random이 아니라 암호학적 난수(randomInt)를 쓴다 — 예측 방지.
export function generatePairCode(): string {
  return String(randomInt(0, 10 ** PAIR_CODE_DIGITS)).padStart(PAIR_CODE_DIGITS, "0");
}

// ── 연결코드 무차별 대입(코드 찍기) 방어 ────────────────────────────────
// 6자리는 100만 가지뿐이라, 빠르게 찍으면 "지금 살아있는 누군가의 코드"를 맞힐 수 있다.
// 맞히면 그 직원 이름으로 연장근무 신청까지 만들 수 있으므로(근로시간 기록 위조) 반드시 막아야 한다.
//
// 방어를 **두 겹**으로 둔다:
//  ① IP별 — 같은 곳에서 반복 시도하는 경우.
//  ② 전체(IP 무관) — ⚠️ 이게 핵심이다. 이 서버는 프록시 없이 뜨는 경우가 많아 요청에서 IP를 못 읽을 수 있고,
//    IP를 읽더라도 공격자가 X-Forwarded-For 값을 매번 바꿔 IP별 방어를 피할 수 있다.
//    그래서 "IP를 모르든 알든" 전체 실패 횟수가 한도를 넘으면 페어링 창구를 잠시 닫는다.
//    정상 사용자는 방금 받은 코드를 입력하므로 실패가 거의 없다(닫혀도 짧은 시간 뒤 자동 해제).
//  · 서버 메모리에만 둔다(DB 표 추가 없음). 재시작되면 초기화되지만, 공격은 짧은 시간에 몰아치므로 유효하다.
const PAIR_FAIL_LIMIT = 10;                       // IP별: 이 횟수 이상 실패하면
const PAIR_FAIL_WINDOW_MS = 10 * 60 * 1000;       // 10분간 차단
const GLOBAL_FAIL_LIMIT = 30;                     // 전체: 1분 안에 이만큼 실패하면
const GLOBAL_WINDOW_MS = 60 * 1000;               // 창구를 1분간 닫는다(자동 해제)
const pairFails = new Map<string, { count: number; firstAt: number }>();
let globalFails = { count: 0, firstAt: 0 };

export function isPairBlocked(ip: string | null): boolean {
  const now = Date.now();
  // ② 전체 한도 — IP를 몰라도 항상 적용된다.
  if (now - globalFails.firstAt <= GLOBAL_WINDOW_MS && globalFails.count >= GLOBAL_FAIL_LIMIT) return true;

  // ① IP별 한도
  if (!ip) return false;
  const rec = pairFails.get(ip);
  if (!rec) return false;
  if (now - rec.firstAt > PAIR_FAIL_WINDOW_MS) {
    pairFails.delete(ip); // 시간이 지났으면 잊는다
    return false;
  }
  return rec.count >= PAIR_FAIL_LIMIT;
}

export function recordPairFail(ip: string | null): void {
  const now = Date.now();

  // ② 전체 카운터(IP를 모르는 요청도 반드시 센다)
  if (now - globalFails.firstAt > GLOBAL_WINDOW_MS) globalFails = { count: 1, firstAt: now };
  else globalFails.count += 1;

  if (!ip) return;
  const rec = pairFails.get(ip);
  if (!rec || now - rec.firstAt > PAIR_FAIL_WINDOW_MS) {
    pairFails.set(ip, { count: 1, firstAt: now });
    return;
  }
  rec.count += 1;
  // 메모리가 무한정 늘지 않도록, 기록이 많아지면 오래된 것부터 정리한다.
  if (pairFails.size > 5000) {
    for (const [k, v] of pairFails) {
      if (now - v.firstAt > PAIR_FAIL_WINDOW_MS) pairFails.delete(k);
    }
  }
}

// 성공했을 때 그 IP의 실패 기록만 지운다.
//  · 전체 카운터는 일부러 건드리지 않는다 — 공격자가 자기 코드 하나를 성공시켜 전체 방어를 풀어버리지 못하게.
export function clearPairFails(ip: string | null): void {
  if (ip) pairFails.delete(ip);
}

// ── 요청 본문 크기 제한 ───────────────────────────────────────────────
// JSON을 통째로 읽은 뒤에 "건수"를 검사하면 이미 늦다 — 수백 MB짜리 본문이 메모리를 다 먹는다.
// 특히 /pair는 **로그인 없이** 부를 수 있는 창구라, 아무나 큰 본문을 던져 서버를 마비시킬 수 있다.
// 그래서 읽기 전에 Content-Length부터 확인한다.
export function tooLarge(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get("content-length") ?? "0");
  return Number.isFinite(len) && len > maxBytes;
}
export const MAX_BODY_PAIR = 4 * 1024;      // 연결 요청은 아주 작다(코드·PC이름뿐)
export const MAX_BODY_EVENTS = 256 * 1024;  // 사건 100건 배치 여유분

// ── 요청 인증 ────────────────────────────────────────────────────────
// 앱이 보낸 `Authorization: Bearer <토큰>` 헤더에서 토큰을 꺼낸다.
export function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+([A-Za-z0-9_-]+)$/.exec(h.trim());
  return m ? m[1] : null;
}

export type AgentAuth = {
  device: { id: string; deviceName: string; agentVersion: string | null };
  user: { id: string; name: string; companyId: string; departmentId: string | null; pcOffExempt: boolean };
};

// 인증 실패 사유. 라우트가 이걸 그대로 401 메시지로 쓴다(사유를 자세히 알려주지 않는다 — 정보 노출 방지).
export type AgentAuthResult = { ok: true; auth: AgentAuth } | { ok: false; status: 401; error: string };

// 기기 토큰 검증 — 이 함수 하나를 모든 에이전트 API가 통과해야 한다.
// 막는 것: ①토큰 없음 ②없는 토큰 ③관리자가 연결 해제(revoke)한 기기 ④퇴사 처리된 직원의 기기
export async function authenticateAgent(req: Request): Promise<AgentAuthResult> {
  const token = extractBearer(req);
  if (!token) return { ok: false, status: 401, error: "인증이 필요합니다." };

  const device = await prisma.agentDevice.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true, deviceName: true, agentVersion: true, revokedAt: true,
      user: { select: { id: true, name: true, companyId: true, departmentId: true, pcOffExempt: true, deactivatedAt: true } },
    },
  });
  if (!device) return { ok: false, status: 401, error: "인증이 필요합니다." };
  if (device.revokedAt) return { ok: false, status: 401, error: "연결이 해제된 기기입니다. 다시 연결해주세요." };
  if (device.user.deactivatedAt) return { ok: false, status: 401, error: "사용할 수 없는 계정입니다." };

  return {
    ok: true,
    auth: {
      device: { id: device.id, deviceName: device.deviceName, agentVersion: device.agentVersion },
      user: {
        id: device.user.id, name: device.user.name, companyId: device.user.companyId,
        departmentId: device.user.departmentId, pcOffExempt: device.user.pcOffExempt,
      },
    },
  };
}

// 생존신호 — 앱이 요청할 때마다 "마지막으로 연락한 시각"을 남긴다. [PC관리] 화면의 온라인/오프라인 판정 근거.
//  · 앱 버전이 바뀌었으면 함께 갱신(업데이트 안내용).
export async function touchDevice(deviceId: string, agentVersion?: string | null): Promise<void> {
  await prisma.agentDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date(), ...(agentVersion ? { agentVersion } : {}) },
  });
}

// 기기가 "온라인"인지 — 마지막 연락이 10분 안이면 온라인으로 본다(정책 조회 주기 5분의 2배 여유).
export const ONLINE_WINDOW_MS = 10 * 60 * 1000;
export function isDeviceOnline(lastSeenAt: Date | null): boolean {
  return !!lastSeenAt && Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

// ── 연결코드 검증(페어링) ─────────────────────────────────────────────
// 코드가 맞고·안 만료됐고·아직 안 쓴 것이면 그 코드의 주인(userId)을 돌려준다.
export async function consumePairCode(code: string): Promise<{ userId: string; codeId: string } | null> {
  if (!/^\d{6}$/.test(code)) return null;

  const rows = await prisma.agentPairCode.findMany({
    where: { code, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true },
  });

  // ⚠️ 살아있는 같은 코드가 2개 이상이면 **누구 것인지 알 수 없다** → 실패시킨다(재발급 유도).
  //    아주 드물지만, 여기서 아무거나 고르면 A 직원의 PC가 B 직원 계정에 연결되고
  //    A가 낸 연장근무 신청이 B 이름으로 B 회사 결재함에 올라간다(조용히 일어나는 사고).
  if (rows.length !== 1) return null;
  const hit = rows[0];

  // 1회용 — 지금 이 순간 "아직 안 쓴 것"이었을 때만 쓴 것으로 표시한다(동시에 두 번 들어와도 하나만 성공).
  const claimed = await prisma.agentPairCode.updateMany({
    where: { id: hit.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  return { userId: hit.userId, codeId: hit.id };
}
