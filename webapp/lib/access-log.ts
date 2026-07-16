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

// [접속기록 자동 파기 — 2년] 접속기록은 "빨리 지워야 할 개인정보"가 아니라 **보관 의무**가 있는 자료다.
//
// 📌 법적 근거(2026-07-16 확정): 「개인정보의 안전성 확보조치 기준」 제8조
//    · 원칙: 접속기록 1년 이상 보관·관리
//    · 예외: **고유식별정보 또는 민감정보를 처리하는 개인정보처리시스템은 2년 이상**
//    이 제품은 얼굴(생체인식정보) = 민감정보를 처리한다(개인정보 보호법 §23, 시행령 §18)
//    → CLAUDE.md 법적 가드레일의 "얼굴 = 생체정보 = 민감정보"와 일치 → **2년(730일) 적용**.
//    보유기간이 지나면 파기해야 하므로(개인정보 보호법 §21) 730일 경과분만 삭제한다.
//
// 방식: 사진 90일 파기(clock-photo.ts)와 동일 — 별도 스케줄러 없이 보안 화면을 열 때 하루 1회만 돈다.
// ⚠️ 사진(생체정보 원본)은 빨리 지울수록 좋고, 접속기록(감사 로그)은 오래 남겨야 한다 — 성격이 정반대다.
//    이 숫자를 줄이는 것은 법 위반이 될 수 있다. 변경 전 반드시 법무 확인.
export const ACCESS_RETENTION_DAYS = 730; // 2년 — 법정 하한(민감정보 처리 시스템)

let lastAccessPurgeAt = 0;
export async function purgeExpiredAccessEvents(): Promise<void> {
  const now = Date.now();
  if (now - lastAccessPurgeAt < 24 * 60 * 60 * 1000) return; // 하루 1회
  lastAccessPurgeAt = now;

  try {
    const cutoff = new Date(now - ACCESS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const r = await prisma.accessEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (r.count > 0) {
      console.log(`[access-log] 보관기간(${ACCESS_RETENTION_DAYS}일) 지난 접속기록 ${r.count}건 파기 완료`);
    }
  } catch (e) {
    // 파기 실패가 화면 조회를 막으면 안 됨 — 로그만 남기고 나중에 재시도.
    // ⚠️ 0으로 되돌리지 않는다: DB 잠금·타임아웃 같은 장애 중이면 화면을 열 때마다 무거운 DELETE를
    //    다시 던져 부하를 키운다. 1시간 뒤 재시도하도록 뒤로 물린다(백오프).
    lastAccessPurgeAt = now - 23 * 60 * 60 * 1000;
    console.error("[access-log] 자동 파기 실패(1시간 뒤 재시도):", e);
  }
}
