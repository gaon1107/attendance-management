// 운영자(본사) 로그인 세션 — 고객사 로그인(lib/session.ts)과 **완전히 별개의 문**이다.
//
// 🔴 왜 별개인가: prisma/schema.prisma 의 Operator 모델 위 주석(①~③)에 이유가 다 적혀 있다.
//    한 줄 요약 — 기존 권한 검사 117군데를 건드리지 않으려고. 그래서 여기는 lib/session.ts 를
//    **고치지도, 부르지도 않는다.** 두 세션은 쿠키 이름부터 다르므로 서로를 지우지 않는다
//    (운영자로 로그인해도 사장님의 고객사 로그인은 그대로 유지된다).
//
// 🔴 정책을 고객사보다 **더 엄하게** 잡은 이유
//    운영자는 회사 칸막이(companyId 격리)를 넘어 **전체 회원사를 보는** 유일한 계정이다.
//    고객사 관리자가 7일·12시간 유휴인데(lib/session.ts), 그보다 더 센 권한을 더 느슨하게 둘 수는 없다.
//      · 8시간   = 하루 업무 한 나절. 다음 날 아침엔 다시 로그인한다.
//      · 30분 유휴 = 자리를 비운 사이 화면이 열려 있는 시간을 짧게 끊는다.
//    ⚠️ 이 숫자를 늘리려면 "왜 전체를 보는 계정을 더 오래 열어 두는가"에 답이 있어야 한다.
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "./db";

// ⚠️ 고객사 쿠키 이름은 "session"이다. 절대 같은 이름을 쓰지 말 것 — 한쪽 로그인이 다른 쪽을 덮어쓴다.
const COOKIE_NAME = "op_session";

const MAX_MS = 8 * 60 * 60 * 1000; // 8시간 — 이 시각이 지나면 무조건 끊는다
const IDLE_MS = 30 * 60 * 1000; // 30분 미사용 → 끊음
/** 마지막 활동 시각을 다시 쓰기까지의 최소 간격. ⚠️ 이게 없으면 화면 열 때마다 DB 쓰기가 터진다. */
const IDLE_TOUCH_MS = 5 * 60 * 1000;

/** 로그인 성공 시 호출 — 세션 발급 + 쿠키 설정. */
export async function createOperatorSession(operatorId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_MS);
  await prisma.operatorSession.create({ data: { token, operatorId, expiresAt, lastSeenAt: now } });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true, // JS로 못 읽게(보안)
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    // ⚠️ path는 고객사 쿠키와 같은 "/"로 둔다. "/operator"로 좁히면 노출이 조금 줄지만,
    //    쿠키를 지울 때도 같은 path를 정확히 넘겨야 해서 로그아웃이 조용히 실패하는 함정이 생긴다.
    //    가장 중요한 문에 새로운 실패 모드를 만들지 않는 쪽을 택했다(쿠키는 httpOnly라 JS로 못 읽는다).
    path: "/",
  });
}

/**
 * 현재 로그인한 운영자를 반환(없으면 null).
 *
 * 🔴 **회원사 목록처럼 회사 칸막이를 넘는 화면은 반드시 이 함수로 먼저 확인한다.**
 *    Next의 layout은 page와 나란히 렌더되므로 layout에서 막는 것은 방어가 되지 않는다 — 각 page 맨 위에서 부른다.
 */
export async function getCurrentOperator() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.operatorSession.findUnique({
    where: { token },
    include: { operator: true },
  });
  if (!session) return null;

  const now = new Date();
  // 만료된 세션은 즉시 정리(DB에 쌓이지 않게)하고 로그아웃 처리.
  if (session.expiresAt < now) {
    await prisma.operatorSession.deleteMany({ where: { token } });
    return null;
  }
  // 유휴 만료 — 30분 넘게 아무 화면도 열지 않았으면 끊는다.
  if (now.getTime() - session.lastSeenAt.getTime() > IDLE_MS) {
    await prisma.operatorSession.deleteMany({ where: { token } });
    return null;
  }
  // 끈 계정(active=false)은 로그인 상태로 보지 않는다.
  //  · 세션을 지우지는 않는다 — 다시 켜면 남은 시간 동안 그대로 쓸 수 있게(끄기는 되돌릴 수 있는 조치다).
  if (!session.operator.active) return null;

  // 마지막 활동 시각 갱신 — **5분에 한 번만.**
  //  ⚠️ 조건 없이 쓰면 안 된다. 이 함수는 화면마다 불리고, 매 요청 쓰기가 생기면 SQLite 쓰기 락이
  //     **직원들의 출퇴근 기록과 경합한다**(운영자 한 명 때문에 고객 서비스가 느려지는 일은 없어야 한다).
  //  ⚠️ 조건을 where에 넣어 한 방(updateMany)으로 처리한다 — 읽고 판단해서 쓰면 같은 세션의
  //     동시 요청이 둘 다 통과해 중복 쓰기가 난다.
  //  · 기록 실패가 로그인 상태를 끊으면 안 되므로 조용히 무시한다(부가 기능).
  if (now.getTime() - session.lastSeenAt.getTime() > IDLE_TOUCH_MS) {
    const cutoff = new Date(now.getTime() - IDLE_TOUCH_MS);
    try {
      await prisma.operatorSession.updateMany({
        where: { token, lastSeenAt: { lt: cutoff } },
        data: { lastSeenAt: now },
      });
    } catch (e) {
      // ⚠️ 에러 객체를 통째로 찍지 않는다 — Prisma 검증 에러는 인자(세션 토큰)를 펼쳐 넣는다(사규 8).
      console.warn("[operator-session] 마지막 활동 시각 갱신 실패(무시):", e instanceof Error ? e.message : String(e));
    }
  }

  return session.operator;
}

/** 로그아웃 — 세션 삭제 + 쿠키 제거. */
export async function destroyOperatorSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.operatorSession.deleteMany({ where: { token } });
    cookieStore.delete(COOKIE_NAME);
  }
}
