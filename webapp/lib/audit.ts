// 관리자 감사로그 — "누가 언제 무엇을 바꿨나"를 한 줄로 남기는 도구(접속/보안 4단계).
//
// 설계 원칙 3가지:
//  ① **본기능을 절대 막지 않는다** — 기록이 실패해도 설정 저장·생체정보 파기는 정상 완료된다.
//     recordAccess 자체도 try/catch지만, headers() 호출이 던질 수 있어 여기서 한 번 더 감싼다.
//  ② **바꾼 "값"은 남기지 않는다** — 어느 설정을 건드렸는지 이름(target)만 남긴다.
//     값을 통째로 남기면 로그가 개인정보·비밀값 유출 통로가 된다.
//  ③ **성공한 뒤에만 부른다** — 호출부에서 검증·권한·DB저장이 끝난 지점에서만 호출할 것.
//     ⚠️ redirect()로 끝나는 액션은 반드시 **redirect 앞에서** 부른다(redirect는 예외를 던져 뒤 코드를 건너뜀).
import { headers } from "next/headers";
import { recordAccess, readClientMeta, type AccessKind } from "@/lib/access-log";

// 감사 대상 행위자(로그인한 사용자에서 필요한 것만)
type Actor = { id: string; companyId: string; name: string };

// 기록할 관리자 행위 종류 — AccessEvent.kind에 이미 정의된 값만 쓴다.
type AuditKind = Extract<AccessKind, "config" | "purge" | "data_view">;

/**
 * 관리자 행위 1건 기록.
 * @param actor 행위자(로그인 사용자)
 * @param kind  "config"(설정 변경) | "purge"(생체정보 파기) | "data_view"(민감정보 조회)
 * @param target 무엇을 건드렸는지 **이름만** (예: "office_network"). 값·개인정보 금지.
 */
export async function logAdminAction(actor: Actor, kind: AuditKind, target: string): Promise<void> {
  try {
    const { ip, userAgent } = readClientMeta(await headers());
    await recordAccess({
      companyId: actor.companyId,
      userId: actor.id,
      actorName: actor.name,
      kind,
      result: "success",
      ip,
      userAgent,
      meta: target,
    });
  } catch (e) {
    // 기록 실패는 본기능(설정 저장·파기)을 막지 않는다 — 경고만.
    console.warn("[audit] 관리자 동작 기록 실패(본작업은 정상 처리됨):", e);
  }
}
