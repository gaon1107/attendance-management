// 관리자 감사로그 — "누가 언제 무엇을 바꿨나"를 한 줄로 남기는 도구(접속/보안 4단계).
//
// 설계 원칙 4가지:
//  ① **본기능을 절대 막지 않는다** — 기록이 실패해도 설정 저장·생체정보 파기는 정상 완료된다.
//     헤더는 미리 읽고 기록은 after()로 응답을 보낸 뒤 실행한다(attendance.ts와 동일 패턴).
//     → 기록이 느려도(예: 파기 배치가 도는 중 SQLite 쓰기 락) 관리자 화면이 기다리지 않는다.
//  ② **바꾼 "값"은 남기지 않는다** — 어느 설정을 건드렸는지 이름(target)만 남긴다.
//     값을 통째로 남기면 로그가 개인정보·비밀값 유출 통로가 된다.
//     (예외: 생체정보 파기의 "대상 직원"은 감사의 핵심이라 남긴다 — 누구 것을 지웠는지 모르면 의미가 없다)
//  ③ **성공한 뒤에만 부른다** — 호출부에서 검증·권한·DB저장이 끝난 지점에서만 호출할 것.
//     ⚠️ redirect()로 끝나는 액션은 반드시 **redirect 앞에서** 부른다(redirect는 예외를 던져 뒤 코드를 건너뜀).
//  ④ **사실과 다르게 말하지 않는다** — 실제로 한 일만, 실제 결과대로 기록한다.
//     · 지울 생체정보가 없었으면 "파기"로 기록하지 않는다(가짜 파기 기록 금지 — 호출부 책임).
//     · 파기가 실패했으면 result="fail"로 남긴다. "성공"으로 기록하면 감사에서 허위 진술이 된다.
import { headers } from "next/headers";
import { after } from "next/server";
import { recordAccess, readClientMeta, type AccessKind, type AccessResult } from "@/lib/access-log";

// 감사 대상 행위자(로그인한 사용자에서 필요한 것만)
type Actor = { id: string; companyId: string; name: string };

// 기록할 관리자 행위 종류 — AccessEvent.kind에 정의돼 있고 **화면·엑셀에서 실제로 보이는 것만** 허용한다.
// ⚠️ 여기에 종류를 늘리려면 반드시 security/access/page.tsx의 ACCESS_KINDS와 export/route.ts의
//    KIND_GROUPS에도 함께 넣을 것. 안 그러면 DB엔 쌓이는데 아무 화면에도 안 보이고 2년 뒤 조용히 파기된다.
//    (참고: "data_view"는 kind에 정의는 돼 있으나 아직 쓰는 곳이 없어 여기서 제외 — 쓸 때 화면과 함께 추가)
type AuditKind = Extract<AccessKind, "config" | "purge">;

/**
 * 관리자 행위 1건 기록.
 * @param actor  행위자(로그인 사용자)
 * @param kind   "config"(설정 변경) | "purge"(생체정보 파기)
 * @param target 무엇을 건드렸는지 **이름만** (예: "office_network"). 설정 값·비밀값 금지.
 * @param result 실제 결과. 기본 "success". 실패했으면 반드시 "fail"을 넘길 것(원칙 ④).
 */
export async function logAdminAction(
  actor: Actor,
  kind: AuditKind,
  target: string,
  result: AccessResult = "success"
): Promise<void> {
  try {
    // 헤더는 after 밖에서 미리 읽는다(요청 컨텍스트가 살아있을 때).
    const { ip, userAgent } = readClientMeta(await headers());
    after(() =>
      recordAccess({
        companyId: actor.companyId,
        userId: actor.id,
        actorName: actor.name,
        kind,
        result,
        ip,
        userAgent,
        meta: target,
      })
    );
  } catch (e) {
    // 기록 실패는 본기능(설정 저장·파기)을 막지 않는다 — 경고만.
    console.warn("[audit] 관리자 동작 기록 실패(본작업은 정상 처리됨):", e);
  }
}
