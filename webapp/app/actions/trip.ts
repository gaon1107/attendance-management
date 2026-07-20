"use server";
// 출장 신청/취소(직원) + 승인/반려(관리자·부서장 결재선).
//  · 구조는 재택(actions/remote.ts)과 동일 + 출장지(destination) 필수. 승인은 "허가 기록"만 — 근태 판정 무접촉.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseYmd } from "@/lib/leave";
import { MAX_TRIP_DAYS } from "@/lib/trip";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps } from "@/lib/approval-server";
import { deleteAttachmentsForRequest } from "@/lib/request-attachment-server";

// 직원: 출장 신청. 기간(시작~종료)·출장지·사유를 받아 대기 상태로 만든다.
//  · 성공 시 생성된 신청 id를 함께 반환한다(클라이언트 첨부 업로드용).
export async function requestTrip(
  _prev: { error?: string; ok?: boolean; id?: string },
  formData: FormData
): Promise<{ error?: string; ok?: boolean; id?: string }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const start = parseYmd(String(formData.get("startDate") ?? ""));
  const end = parseYmd(String(formData.get("endDate") ?? ""));
  if (!start) return { error: "시작일을 선택해주세요." };
  if (!end) return { error: "종료일을 선택해주세요." };
  if (end < start) return { error: "종료일이 시작일보다 빠릅니다." };
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (spanDays > MAX_TRIP_DAYS) return { error: `한 번에 신청할 수 있는 기간(${MAX_TRIP_DAYS}일)을 넘었습니다. 기간을 나눠 신청해주세요.` };

  const destRaw = String(formData.get("destination") ?? "").trim();
  if (!destRaw) return { error: "출장지를 입력해주세요." };
  const destination = Array.from(destRaw).slice(0, 200).join(""); // 코드포인트 기준 상한

  const reasonRaw = String(formData.get("reason") ?? "").trim();
  const reason = reasonRaw ? Array.from(reasonRaw).slice(0, 500).join("") : null;

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { approvalMode: true, approvalStepCount: true },
  });

  const created = await prisma.businessTripRequest.create({
    data: { companyId: me.companyId, userId: me.id, startDate: start, endDate: end, destination, reason },
  });
  // 부서장 결재선을 켠 회사면 결재 단계를 생성(비결재선/결재자 없음이면 만들지 않음=관리자 단일 승인).
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "trip", created.id);

  revalidatePath("/trip");
  return { ok: true, id: created.id };
}

// 직원: 대기 중인 내 신청 취소(삭제). 이미 승인/반려된 건 취소 불가.
export async function cancelTrip(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const t = await prisma.businessTripRequest.findFirst({ where: { id, userId: me.id, companyId: me.companyId, status: "pending" } });
  if (!t) return;
  await deleteApprovalSteps(me.companyId, "trip", t.id); // 결재 단계도 함께 정리(고아 방지)
  await deleteAttachmentsForRequest(me.companyId, "trip", t.id); // 첨부파일·파일 정리
  await prisma.businessTripRequest.delete({ where: { id: t.id } });
  revalidatePath("/trip");
  revalidatePath("/approvals");
}

// 승인 — 회사 격리. 단일 승인이면 관리자만, 부서장 결재선이면 현재 단계 결재자(또는 관리자 오버라이드).
export async function approveTrip(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  const comment = raw ? Array.from(raw).slice(0, 500).join("") : undefined; // 승인 사유는 선택, 코드포인트 기준 상한
  const t = await prisma.businessTripRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!t) return;
  const result = await advanceApproval(me, "trip", t.id, "approve", comment);
  if (result === "denied") return;
  if (result === "approved") {
    await prisma.businessTripRequest.updateMany({ where: { id: t.id, companyId: me.companyId, status: "pending" }, data: { status: "approved", decidedAt: new Date(), decisionComment: comment ?? null, decidedById: me.id } });
  }
  revalidatePath("/trip/approvals");
  revalidatePath("/trip");
  revalidatePath("/approvals");
}

// 반려 — 회사 격리. 어느 단계든 반려하면 원본을 반려 확정한다. 반려 사유 필수.
export async function rejectTrip(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  if (!raw) return; // 반려 사유 필수 — 서버에서도 강제(클라이언트 우회·JS-off 폼 위조 방어)
  const comment = Array.from(raw).slice(0, 500).join(""); // 코드포인트 기준 상한(이모지 깨짐 방지)
  const t = await prisma.businessTripRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!t) return;
  const result = await advanceApproval(me, "trip", t.id, "reject", comment);
  if (result === "denied") return;
  await prisma.businessTripRequest.updateMany({ where: { id: t.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date(), decisionComment: comment, decidedById: me.id } });
  revalidatePath("/trip/approvals");
  revalidatePath("/trip");
  revalidatePath("/approvals");
}
