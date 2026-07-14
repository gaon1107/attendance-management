// 접속·보안 이벤트 한 줄 기록 도구.
//  · 절대 원칙: 이 기록이 실패해도 본기능(로그인·출퇴근 등)을 막지 않는다 → 전부 try/catch, 실패는 경고 로그만.
//  · IP·기기는 호출부에서 요청 헤더로 뽑아 넘긴다(여기선 next/headers를 직접 읽지 않음 — 서버액션/라우트 어디서든 쓰이게).
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/ip";
import { deviceLabel } from "@/lib/device";

// .get(name)을 가진 헤더 객체(next/headers의 headers() 반환값, 표준 Headers 모두)
type HeaderLike = { get(name: string): string | null };

export type AccessKind =
  | "login" | "login_fail" | "logout"
  | "clock_in" | "clock_out"
  | "config" | "purge" | "data_view" | "blocked";

export type AccessResult = "success" | "fail" | "blocked";

export type AccessInput = {
  companyId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  emailTried?: string | null;
  kind: AccessKind;
  result: AccessResult;
  ip?: string | null;
  userAgent?: string | null;
  meta?: string | null;
};

// 접속 이벤트 1건 기록. 실패해도 조용히 넘어간다(본기능 보호).
export async function recordAccess(e: AccessInput): Promise<void> {
  try {
    await prisma.accessEvent.create({
      data: {
        companyId: e.companyId ?? null,
        userId: e.userId ?? null,
        actorName: e.actorName ?? null,
        emailTried: e.emailTried ?? null,
        kind: e.kind,
        result: e.result,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
        device: e.userAgent ? deviceLabel(e.userAgent) : null,
        meta: e.meta ?? null,
      },
    });
  } catch (err) {
    // 기록 실패는 본기능을 막지 않는다 — 경고만 남긴다.
    console.warn("[access-log] 이벤트 기록 실패(무시):", err);
  }
}

// 요청 헤더에서 IP·User-Agent를 함께 뽑는 편의 함수(호출부 반복 축소).
export function readClientMeta(h: HeaderLike): { ip: string | null; userAgent: string | null } {
  return { ip: getClientIp(h), userAgent: h.get("user-agent") };
}
