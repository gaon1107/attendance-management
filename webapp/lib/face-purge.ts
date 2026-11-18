// 얼굴서버(GaonFR)에 등록된 얼굴 원본을 "안전하게" 삭제한다 — 생체정보 파기의 마지막 조각.
//
// 2026-11-19 운영 준비 5단계: 원래 app/actions/authmethod.ts 안에만 있던 함수를 옮겼다.
//   본인 삭제(app/actions/face.ts deleteMyFace)·퇴사 처리(app/actions/employees.ts)·동의 철회·관리자 파기가 **같은 규칙**을 쓴다.
//   예전 본인 삭제는 얼굴서버 삭제가 실패해도 "삭제됨"으로 표시해, 서버에 얼굴이 남는 결함이 있었다(2단계 검수 ②).
//
// 규칙(호출하는 모든 곳 공통):
//   · 실패해도 예외를 던지지 않는다 — 삭제 실패가 철회·퇴사 같은 본 처리를 막으면 안 된다. 결과만 알린다.
//   · 🔴 호출부는 결과가 "failed"가 아닐 때만 우리 DB의 등록 표시(faceEnrolledAt)를 지운다.
//     DB부터 지우면 "우리 표시는 미등록인데 서버엔 얼굴이 남는" 최악의 잔존이 조용히 굳는다(다시 지울 단서가 사라짐).
//   · FaceId = 직원 id, Group = 회사 id (lib/face.ts 데이터 규칙)
//
// 결과 4가지(5-2 검수 M2, 2026-11-19) — 감사기록이 "실제로 무슨 일이 있었는지"를 사실대로 남기도록 구분한다.
//   deleted = 얼굴서버에서 실제로 지웠다
//   absent  = 삭제를 요청했지만 서버에 그 얼굴이 없었다(이미 지워졌거나, 다른 얼굴서버·계정·회사 묶음으로 등록된 것)
//             ⚠️ 얼굴서버는 지운 게 0건이어도 "성공(200)"으로 답한다. 응답의 지운 목록(Faces)으로만 구분할 수 있다.
//   skipped = 요청할 필요가 없었다(등록 표시도 생체정보 이력도 없음)
//   failed  = 실패·시간 초과 — 얼굴이 남았을 수 있다
//
// 언제 요청하나(5-2 검수 M3): 등록 표시(enrolled)가 없어도 생체정보 이력(history — 얼굴인증 선택·동의)이 있으면 요청한다.
//   등록 직후 DB 저장이 실패했거나, 등록과 퇴사가 거의 동시에 일어나면 "서버엔 얼굴이 있는데 표시는 없는" 상태가 생길 수 있다.
//   단, 얼굴서버 설정이 없는 환경에서 등록 표시도 없으면 요청하지 않는다(그 설정으로는 등록될 수도 없었다).
//
// 시간 상한: 얼굴서버 요청마다 10초 제한이 있지만(lib/face.ts), 로그인·토큰 발급·재시도가 이어지면 길어질 수 있어
//   전체를 15초로 한 번 더 묶는다. 넘기면 failed → 등록 표시를 남겨 다음 파기 때 재시도. 뒤늦게 끝나는 요청은 무시해도 무해.
import { unenrollFace, isFaceConfigured } from "@/lib/face";

export type UnenrollOutcome = "deleted" | "absent" | "skipped" | "failed";

const OVERALL_TIMEOUT_MS = 15_000;

export async function unenrollFaceOutcome(
  userId: string,
  companyId: string,
  state: { enrolled: boolean; history: boolean }
): Promise<UnenrollOutcome> {
  if (!state.enrolled && !state.history) return "skipped";
  if (!state.enrolled && !isFaceConfigured()) return "skipped";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ success: false; message: string; deletedCount?: undefined }>((resolve) => {
      timer = setTimeout(() => resolve({ success: false, message: `얼굴서버 응답 시간 초과(${OVERALL_TIMEOUT_MS / 1000}초)` }), OVERALL_TIMEOUT_MS);
    });
    const r = await Promise.race([unenrollFace(userId, companyId), timeout]);
    if (!r.success) {
      console.error("[face-purge] 얼굴서버 원본 삭제 실패:", r.message);
      return "failed";
    }
    if ((r.deletedCount ?? 0) > 0) return "deleted";
    // 등록 표시가 있었는데 서버에 없었다면 기록해 둔다 — 다른 얼굴서버(개발)에 등록된 얼굴일 수 있다(운영 전환 직후 등).
    if (state.enrolled) console.warn(`[face-purge] 등록 표시는 있었으나 얼굴서버에 지울 얼굴이 없음(직원 ${userId})`);
    return "absent";
  } catch (e) {
    console.error("[face-purge] 얼굴서버 원본 삭제 오류:", e);
    return "failed";
  } finally {
    if (timer) clearTimeout(timer); // 먼저 끝나면 남은 타이머 정리(대량 파기 시 타이머 누적 방지)
  }
}

// 예전 모양(참/거짓) 그대로 쓰는 곳(본인 얼굴 삭제)을 위한 얇은 감싸개.
//   반환값 = "얼굴서버에 남은 얼굴이 없음이 보장되는가". 등록이 없었으면 지울 것도 없으므로 true.
export async function unenrollFaceSafely(userId: string, companyId: string, wasEnrolled: boolean): Promise<boolean> {
  return (await unenrollFaceOutcome(userId, companyId, { enrolled: wasEnrolled, history: false })) !== "failed";
}

// 감사기록 상세(괄호 안)에 붙일 한 마디 — 실제로 지웠거나 요청할 필요가 없었으면 빈 문자열.
//  ⚠️ 괄호 문자를 넣지 않는다. 접속기록 화면은 meta 끝의 괄호 하나를 "상세"로 읽는다(lib/access-labels.ts).
export function unenrollAuditNote(o: UnenrollOutcome): string {
  if (o === "absent") return "얼굴서버에 지울 얼굴 없음";
  if (o === "failed") return "얼굴서버 삭제 실패";
  return "";
}
