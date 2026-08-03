// [신청 취소] 대기 중인 내 신청을 지우는 공통 처리 — 6종(휴가·정정·외출·재택·초과근무·출장) 공용.
//
// 🔴 왜 공통 함수로 모았나 (검수 M-5)
//   예전에는 각 신청마다 ①결재 단계 삭제 ②첨부 삭제 ③원본 삭제를 **따로따로** 실행했다.
//   ①만 성공하고 ③이 실패하면(서버 재시작·오류) **결재 단계가 0건인 대기 신청**이 남는데,
//   결재 엔진은 "단계 0건 = 결재선을 안 쓰는 회사"로 보고 **관리자 단독 승인**을 허용한다.
//   즉 부서장 결재선이 통째로 사라진 신청이 만들어진다(근태 정정이면 출퇴근 기록이 그대로 바뀐다).
//
// 그래서 지금은:
//   · 원본과 결재 단계를 **한 트랜잭션**으로 함께 지운다(둘 다 지워지거나 둘 다 남는다).
//   · 원본 삭제 조건에 "내 것 + 아직 대기"를 넣어, 삭제 직전에 승인된 건이 지워지는 경합도 막는다.
//   · 첨부 파일은 트랜잭션 **밖**에서 지운다 — 파일 삭제는 되돌릴 수 없어 DB 트랜잭션에 넣을 수 없다.
//     (여기서 실패해도 남는 것은 주인 없는 첨부뿐이라 결재·근태에 영향이 없다)
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { RequestType } from "@/lib/approval-server";
import { isAttachableType } from "@/lib/request-attachment";
import { deleteAttachmentsForRequest } from "@/lib/request-attachment-server";

// 원본 신청을 지우는 방법은 유형마다 표가 달라 호출자가 넘긴다.
// deleteMany를 쓰는 이유: "찾아서 지운다"가 한 번에 끝나야 그 사이 상태가 바뀌는 틈이 없다.
type DeleteOriginal = (tx: Prisma.TransactionClient) => Promise<{ count: number }>;

// 지워졌으면 true, 이미 처리됐거나 내 것이 아니면 false.
export async function cancelPendingRequest(
  companyId: string,
  requestType: RequestType,
  requestId: string,
  deleteOriginal: DeleteOriginal,
): Promise<boolean> {
  if (!requestId) return false;

  let removed = false;
  try {
    removed = await prisma.$transaction(async (tx) => {
      const del = await deleteOriginal(tx);
      if (del.count === 0) return false; // 없음 · 남의 것 · 이미 승인/반려됨
      await tx.approvalStep.deleteMany({ where: { companyId, requestType, requestId } });
      return true;
    });
  } catch (e) {
    // DB가 바쁘거나(SQLITE_BUSY) 트랜잭션이 시간초과되면 화면에 처리되지 않은 오류가 뜬다.
    // 원자성은 지켜지므로(둘 다 안 지워짐) 여기서 삼키고 "취소되지 않음"으로 돌려준다.
    console.error(`[신청취소] 실패(${requestType}/${requestId}) — 아무것도 지워지지 않았습니다:`, e);
    return false;
  }
  if (!removed) {
    // 문의가 들어왔을 때 추적할 수 있도록 남긴다(남의 신청·이미 처리된 건·없는 id).
    console.warn(`[신청취소] 대상 없음 — 이미 처리됐거나 취소 권한이 없습니다(${requestType}/${requestId})`);
    return false;
  }

  if (isAttachableType(requestType)) {
    // 첨부 정리 실패가 "취소 자체"를 되돌리지는 않는다(원본은 이미 사라졌다). 기록만 남긴다.
    await deleteAttachmentsForRequest(companyId, requestType, requestId).catch((e) => {
      console.error(`[신청취소] 첨부 정리 실패(${requestType}/${requestId}) — 주인 없는 첨부가 남을 수 있음:`, e);
    });
  }
  return true;
}
