"use server";
// 초과근무(야근) 사전신청/취소(직원) + 승인/반려(관리자·부서장 결재선).
//  · 구조는 외출외근(actions/outing.ts)과 동일. 승인은 "허가 기록"만 — 주52·실근무 계산 무접촉.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseYmd } from "@/lib/leave";
import { isValidHm } from "@/lib/overtime-request";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps, isSelfApprovalBlocked } from "@/lib/approval-server";
import { deleteAttachmentsForRequest } from "@/lib/request-attachment-server";

// 직원: 초과근무 사전신청. 날짜·시각(야근 시간대)·사유를 받아 대기 상태로 만든다.
//  · 성공 시 생성된 신청 id를 함께 반환한다(클라이언트 첨부 업로드용).
export async function requestOvertime(
  _prev: { error?: string; ok?: boolean; id?: string },
  formData: FormData
): Promise<{ error?: string; ok?: boolean; id?: string }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const date = parseYmd(String(formData.get("targetDate") ?? ""));
  if (!date) return { error: "날짜를 올바르게 선택해주세요." };

  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  if (!isValidHm(startTime) || !isValidHm(endTime)) return { error: "시작·종료 시각을 올바르게 입력해주세요." };
  // 야근은 자정을 넘길 수 있어 end<=start를 허용(익일). 단, 완전히 같은 값은 0시간이라 막는다.
  if (startTime === endTime) return { error: "시작 시각과 종료 시각이 같습니다." };

  const reasonRaw = String(formData.get("reason") ?? "").trim();
  const reason = reasonRaw ? Array.from(reasonRaw).slice(0, 500).join("") : null;

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { approvalMode: true, approvalStepCount: true },
  });

  const created = await prisma.overtimeRequest.create({
    data: { companyId: me.companyId, userId: me.id, targetDate: date, startTime, endTime, reason },
  });
  // 부서장 결재선을 켠 회사면 결재 단계를 생성(비결재선/결재자 없음이면 만들지 않음=관리자 단일 승인).
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "overtime", created.id);

  revalidatePath("/overtime");
  return { ok: true, id: created.id };
}

// 직원: 대기 중인 내 신청 취소(삭제). 이미 승인/반려된 건 취소 불가.
export async function cancelOvertime(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const o = await prisma.overtimeRequest.findFirst({ where: { id, userId: me.id, companyId: me.companyId, status: "pending" } });
  if (!o) return;
  await deleteApprovalSteps(me.companyId, "overtime", o.id); // 결재 단계도 함께 정리(고아 방지)
  await deleteAttachmentsForRequest(me.companyId, "overtime", o.id); // 첨부파일·파일 정리
  await prisma.overtimeRequest.delete({ where: { id: o.id } });
  revalidatePath("/overtime");
  revalidatePath("/approvals");
}

// 승인 — 회사 격리. 단일 승인이면 관리자만, 부서장 결재선이면 현재 단계 결재자(또는 관리자 오버라이드).
export async function approveOvertime(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  const comment = raw ? Array.from(raw).slice(0, 500).join("") : undefined; // 승인 사유는 선택, 코드포인트 기준 상한
  const o = await prisma.overtimeRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!o) return;
  // 🔴 자기 신청을 자기가 승인하지 못하게 막는다(다른 관리자가 없으면 허용 — lib/approval-server.ts 설명).
  if (await isSelfApprovalBlocked(me, o.userId)) return;
  const result = await advanceApproval(me, "overtime", o.id, "approve", comment);
  if (result === "denied") return;
  if (result === "approved") {
    await prisma.overtimeRequest.updateMany({ where: { id: o.id, companyId: me.companyId, status: "pending" }, data: { status: "approved", decidedAt: new Date(), decisionComment: comment ?? null, decidedById: me.id } });
  }
  revalidatePath("/overtime/approvals");
  revalidatePath("/overtime");
  revalidatePath("/approvals");
}

// 반려 — 회사 격리. 어느 단계든 반려하면 원본을 반려 확정한다. 반려 사유 필수.
export async function rejectOvertime(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  if (!raw) return; // 반려 사유 필수 — 서버에서도 강제(클라이언트 우회·JS-off 폼 위조 방어)
  const comment = Array.from(raw).slice(0, 500).join(""); // 코드포인트 기준 상한(이모지 깨짐 방지)
  const o = await prisma.overtimeRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!o) return;
  const result = await advanceApproval(me, "overtime", o.id, "reject", comment);
  if (result === "denied") return;
  await prisma.overtimeRequest.updateMany({ where: { id: o.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date(), decisionComment: comment, decidedById: me.id } });
  revalidatePath("/overtime/approvals");
  revalidatePath("/overtime");
  revalidatePath("/approvals");
}
