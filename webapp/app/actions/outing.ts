"use server";
// 외출/외근 신청/취소(직원) + 승인/반려(관리자·부서장 결재선).
//  · 구조는 휴가(actions/leave.ts)와 동일. 승인은 "허가 기록"만 — 근태 판정 로직 무접촉.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseYmd } from "@/lib/leave";
import { OUTING_KIND_KEYS, isValidHm } from "@/lib/outing";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps } from "@/lib/approval-server";

// 직원: 외출/외근 신청. 종류·날짜·시각·장소·사유를 받아 대기 상태로 만든다.
export async function requestOuting(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const kind = String(formData.get("kind") ?? "");
  if (!OUTING_KIND_KEYS.includes(kind)) return { error: "종류(외출/외근)를 선택해주세요." };

  const date = parseYmd(String(formData.get("targetDate") ?? ""));
  if (!date) return { error: "날짜를 올바르게 선택해주세요." };

  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  if (!isValidHm(startTime) || !isValidHm(endTime)) return { error: "시작·종료 시각을 올바르게 입력해주세요." };
  if (endTime <= startTime) return { error: "종료 시각이 시작 시각보다 빨라요." };

  // 장소·사유는 선택. 코드포인트 기준 상한(과도한 입력·이모지 깨짐 방지).
  const placeRaw = String(formData.get("place") ?? "").trim();
  const place = placeRaw ? Array.from(placeRaw).slice(0, 200).join("") : null;
  const reasonRaw = String(formData.get("reason") ?? "").trim();
  const reason = reasonRaw ? Array.from(reasonRaw).slice(0, 500).join("") : null;

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { approvalMode: true, approvalStepCount: true },
  });

  const created = await prisma.outingRequest.create({
    data: { companyId: me.companyId, userId: me.id, kind, targetDate: date, startTime, endTime, place, reason },
  });
  // 부서장 결재선을 켠 회사면 결재 단계를 생성(비결재선/결재자 없음이면 만들지 않음=관리자 단일 승인).
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "outing", created.id);

  revalidatePath("/outing");
  return { ok: true };
}

// 직원: 대기 중인 내 신청 취소(삭제). 이미 승인/반려된 건 취소 불가.
export async function cancelOuting(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const o = await prisma.outingRequest.findFirst({ where: { id, userId: me.id, status: "pending" } });
  if (!o) return;
  await deleteApprovalSteps(me.companyId, "outing", o.id); // 결재 단계도 함께 정리(고아 방지)
  await prisma.outingRequest.delete({ where: { id: o.id } });
  revalidatePath("/outing");
  revalidatePath("/approvals");
}

// 승인 — 회사 격리. 단일 승인이면 관리자만, 부서장 결재선이면 현재 단계 결재자(또는 관리자 오버라이드).
//  · 전 단계가 끝나 체인이 완료될 때만 원본 status를 approved로 바꾼다(그전엔 pending 유지).
export async function approveOuting(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  const comment = raw ? Array.from(raw).slice(0, 500).join("") : undefined; // 승인 사유는 선택, 코드포인트 기준 상한
  const o = await prisma.outingRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!o) return;
  const result = await advanceApproval(me, "outing", o.id, "approve", comment);
  if (result === "denied") return;
  if (result === "approved") {
    // status:"pending" 가드 → 동시/재시도에도 한 번만 확정(멱등). 최종 결정사유·처리자를 원본에 미러(신청자 표시용).
    await prisma.outingRequest.updateMany({ where: { id: o.id, companyId: me.companyId, status: "pending" }, data: { status: "approved", decidedAt: new Date(), decisionComment: comment ?? null, decidedById: me.id } });
  }
  // "advanced" → 다음 결재자 대기, 원본은 pending 유지
  revalidatePath("/outing/approvals");
  revalidatePath("/outing");
  revalidatePath("/approvals");
}

// 반려 — 회사 격리. 어느 단계든 반려하면 원본을 반려 확정한다. 반려 사유 필수.
export async function rejectOuting(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  if (!raw) return; // 반려 사유 필수 — 서버에서도 강제(클라이언트 우회·JS-off 폼 위조 방어)
  const comment = Array.from(raw).slice(0, 500).join(""); // 코드포인트 기준 상한(이모지 깨짐 방지)
  const o = await prisma.outingRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!o) return;
  const result = await advanceApproval(me, "outing", o.id, "reject", comment);
  if (result === "denied") return;
  await prisma.outingRequest.updateMany({ where: { id: o.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date(), decisionComment: comment, decidedById: me.id } });
  revalidatePath("/outing/approvals");
  revalidatePath("/outing");
  revalidatePath("/approvals");
}
