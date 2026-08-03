// 로그인 세션 — 로그인 시 "출입증(토큰)"을 발급해 DB에 저장하고, 브라우저 쿠키엔 토큰만 담는다.
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "./db";

const COOKIE_NAME = "session";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// 로그인 성공 시 호출 — 세션 발급 + 쿠키 설정
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true, // JS로 못 읽게(보안)
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

// 현재 로그인한 사용자를 반환(없으면 null). 회사 정보도 함께 가져온다.
// 🔒 임시 비밀번호(mustChangePassword) 상태면 기본적으로 null — 로그인 안 한 것으로 취급한다(9-C).
//    예전엔 AppShell(화면 뼈대)에서만 막아서, AppShell을 안 거치는 엑셀/PDF/API 라우트와
//    서버 액션 전부(156곳)가 임시 비밀번호 상태로도 호출 가능했다. 인증의 근원인 이 함수에서
//    막으면 새 라우트를 만들어도 자동으로 보호된다.
//    예외(allowMustChange: true)는 임시 비밀번호 상태에서도 되어야 하는 3곳뿐:
//    비밀번호 변경 화면·변경 액션(안 열리면 영영 못 바꿈)·로그아웃(기록용 조회).
export async function getCurrentUser(opts?: { allowMustChange?: boolean }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { company: true } } },
  });
  if (!session) return null;
  // 만료된 세션은 즉시 정리(DB에 쌓이지 않게)하고 로그아웃 처리
  if (session.expiresAt < new Date()) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }
  // 퇴사(비활성화)된 계정이면 로그인 상태로 보지 않는다(방어).
  if (session.user.deactivatedAt) return null;
  // 임시 비밀번호 상태 차단(위 주석). 화면 경로는 각 페이지의 !me → redirect("/login")를 타고,
  // 로그인 폼에서 다시 로그인하면 auth.ts가 /change-password로 보낸다.
  if (session.user.mustChangePassword && !opts?.allowMustChange) return null;
  return session.user;
}

// 로그아웃 — 세션 삭제 + 쿠키 제거
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
    cookieStore.delete(COOKIE_NAME);
  }
}
