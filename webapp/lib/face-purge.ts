// 얼굴서버(GaonFR)에 등록된 얼굴 원본을 "안전하게" 삭제한다 — 생체정보 파기의 마지막 조각.
//
// 2026-11-19 운영 준비 5단계: 원래 app/actions/authmethod.ts 안에만 있던 함수를 그대로 옮겼다.
//   본인 삭제(app/actions/face.ts deleteMyFace)와 퇴사 처리(app/actions/employees.ts)도 **같은 규칙**을 써야 해서다.
//   예전 본인 삭제는 얼굴서버 삭제가 실패해도 "삭제됨"으로 표시해, 서버에 얼굴이 남는 결함이 있었다(2단계 검수 ②).
//
// 규칙(호출하는 모든 곳 공통):
//   · 반환값 = "얼굴서버에 남은 얼굴이 없음이 보장되는가". 등록이 없었으면(wasEnrolled=false) 지울 것도 없으므로 true.
//   · 실패해도 예외를 던지지 않는다 — 삭제 실패가 철회·퇴사 같은 본 처리를 막으면 안 된다. 결과(bool)만 알린다.
//   · 🔴 호출부는 **true일 때만** 우리 DB의 등록 표시(faceEnrolledAt)를 지운다.
//     DB부터 지우면 "우리 표시는 미등록인데 서버엔 얼굴이 남는" 최악의 잔존이 조용히 굳는다(다시 지울 단서가 사라짐).
//   · FaceId = 직원 id, Group = 회사 id (lib/face.ts 데이터 규칙)
//
// ⚠️ lib/face.ts의 unenrollFace에는 요청 타임아웃이 없다(recognize/detect엔 있음). GaonFR이 연결만 받고
//    응답을 주지 않는 "행(hang)" 상태면 예외 없이 무한 대기 → catch가 못 잡고 화면이 멈춘다.
//    그래서 여기서 10초 상한을 건다. (상한 초과 시 false → 등록 표시를 남겨 다음 파기 때 재시도. 뒤늦게 끝나는 fetch는 무시해도 무해.)
import { unenrollFace } from "@/lib/face";

export async function unenrollFaceSafely(userId: string, companyId: string, wasEnrolled: boolean): Promise<boolean> {
  if (!wasEnrolled) return true; // 등록된 얼굴이 없으면 지울 것도 없음
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ success: false; message: string }>((resolve) => {
      timer = setTimeout(() => resolve({ success: false, message: "얼굴서버 응답 시간 초과(10초)" }), 10_000);
    });
    const r = await Promise.race([unenrollFace(userId, companyId), timeout]);
    if (!r.success) console.error("[face-purge] 얼굴서버 원본 삭제 실패:", r.message);
    return r.success;
  } catch (e) {
    console.error("[face-purge] 얼굴서버 원본 삭제 오류:", e);
    return false;
  } finally {
    if (timer) clearTimeout(timer); // 먼저 끝나면 남은 타이머 정리(대량 파기 시 타이머 누적 방지)
  }
}
