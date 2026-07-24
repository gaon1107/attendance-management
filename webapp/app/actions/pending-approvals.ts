"use server";
// 밀린 결재 현황판(관리자)에서 대리로 승인/반려하는 얇은 래퍼.
//  · 실제 처리는 유형별 기존 액션(approveLeave/rejectCorrection 등)을 그대로 재사용한다 —
//    근태정정 실반영·decisionComment 미러·유형별 revalidate가 "검증된 채로" 돈다(재구현 안 함 = 회귀 위험 최소).
//  · 관리자 승인 = advanceApproval의 관리자 오버라이드로 남은 결재선을 건너뛰고 즉시 최종 확정(기존 동작 그대로).
//  · 이 화면은 관리자 전용이므로 여기서도 admin을 강제한다(직원·부서장은 자기 결재함에서 처리).
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { approveLeave, rejectLeave } from "./leave";
import { approveCorrection, rejectCorrection } from "./corrections";
import { approveOuting, rejectOuting } from "./outing";
import { approveRemote, rejectRemote } from "./remote";
import { approveOvertime, rejectOvertime } from "./overtime";
import { approveTrip, rejectTrip } from "./trip";
import { isRequestType, type RequestType } from "@/lib/approval-server";

const APPROVE: Record<RequestType, (fd: FormData) => Promise<void>> = {
  leave: approveLeave,
  correction: approveCorrection,
  outing: approveOuting,
  remote: approveRemote,
  overtime: approveOvertime,
  trip: approveTrip,
};
const REJECT: Record<RequestType, (fd: FormData) => Promise<void>> = {
  leave: rejectLeave,
  correction: rejectCorrection,
  outing: rejectOuting,
  remote: rejectRemote,
  overtime: rejectOvertime,
  trip: rejectTrip,
};

// type·decision은 클라이언트에서 .bind(null, type, decision)으로 미리 묶어 넘어온다. formData는 id(+반려 comment).
export async function decidePendingApproval(
  type: string,
  decision: "approve" | "reject",
  formData: FormData,
): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return; // 관리자 전용(직원·부서장은 결재함에서)
  if (!isRequestType(type)) return; // 화이트리스트 방어(폼 위조)
  await (decision === "approve" ? APPROVE[type] : REJECT[type])(formData);
  // 유형별 액션이 자기 경로(/leave 등)는 이미 revalidate. 현황판도 갱신해 처리한 행이 사라지게 한다.
  revalidatePath("/pending-approvals");
}
