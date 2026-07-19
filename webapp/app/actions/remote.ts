"use server";
// 재택근무 신청/취소(직원) + 승인/반려(관리자·부서장 결재선).
//  · 구조는 휴가(actions/leave.ts)·외출외근(actions/outing.ts)과 동일. 승인은 "허가 기록"만 — 근태 판정 로직 무접촉.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseYmd } from "@/lib/leave";
import { MAX_REMOTE_DAYS } from "@/lib/remote";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps } from "@/lib/approval-server";

// 직원: 재택근무 신청. 기간(시작~종료)·사유를 받아 대기 상태로 만든다.
export async function requestRemote(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const start = parseYmd(String(formData.get("startDate") ?? ""));
  const end = parseYmd(String(formData.get("endDate") ?? ""));
  if (!end) return { error: "종료일을 선택해주세요." };
  if (!start) return { error: "시작일을 선택해주세요." };
  if (end < start) return { error: "종료일이 시작일보다 빠릅니다." };
  // 무제한 장기신청 방지(잔량 개념이 없어 상한을 둔다). 시작·종료 포함 일수로 계산.
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (spanDays > MAX_REMOTE_DAYS) return { error: `한 번에 신청할 수 있는 기간(${MAX_REMOTE_DAYS}일)을 넘었습니다. 기간을 나눠 신청해주세요.` };

  const reasonRaw = String(formData.get("reason") ?? "").trim();
  const reason = reasonRaw ? Array.from(reasonRaw).slice(0, 500).join("") : null;

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { approvalMode: true, approvalStepCount: true },
  });

  const created = await prisma.remoteWorkRequest.create({
    data: { companyId: me.companyId, userId: me.id, startDate: start, endDate: end, reason },
  });
  // 부서장 결재선을 켠 회사면 결재 단계를 생성(비결재선/결재자 없음이면 만들지 않음=관리자 단일 승인).
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "remote", created.id);

  revalidatePath("/remote");
  return { ok: true };
}

// 직원: 대기 중인 내 신청 취소(삭제). 이미 승인/반려된 건 취소 불가.
export async function cancelRemote(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const r = await prisma.remoteWorkRequest.findFirst({ where: { id, userId: me.id, companyId: me.companyId, status: "pending" } });
  if (!r) return;
  await deleteApprovalSteps(me.companyId, "remote", r.id); // 결재 단계도 함께 정리(고아 방지)
  await prisma.remoteWorkRequest.delete({ where: { id: r.id } });
  revalidatePath("/remote");
  revalidatePath("/approvals");
}

// 승인 — 회사 격리. 단일 승인이면 관리자만, 부서장 결재선이면 현재 단계 결재자(또는 관리자 오버라이드).
export async function approveRemote(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  const comment = raw ? Array.from(raw).slice(0, 500).join("") : undefined; // 승인 사유는 선택, 코드포인트 기준 상한
  const r = await prisma.remoteWorkRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!r) return;
  const result = await advanceApproval(me, "remote", r.id, "approve", comment);
  if (result === "denied") return;
  if (result === "approved") {
    await prisma.remoteWorkRequest.updateMany({ where: { id: r.id, companyId: me.companyId, status: "pending" }, data: { status: "approved", decidedAt: new Date(), decisionComment: comment ?? null, decidedById: me.id } });
  }
  revalidatePath("/remote/approvals");
  revalidatePath("/remote");
  revalidatePath("/approvals");
}

// 반려 — 회사 격리. 어느 단계든 반려하면 원본을 반려 확정한다. 반려 사유 필수.
export async function rejectRemote(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("comment") ?? "").trim();
  if (!raw) return; // 반려 사유 필수 — 서버에서도 강제(클라이언트 우회·JS-off 폼 위조 방어)
  const comment = Array.from(raw).slice(0, 500).join(""); // 코드포인트 기준 상한(이모지 깨짐 방지)
  const r = await prisma.remoteWorkRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!r) return;
  const result = await advanceApproval(me, "remote", r.id, "reject", comment);
  if (result === "denied") return;
  await prisma.remoteWorkRequest.updateMany({ where: { id: r.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date(), decisionComment: comment, decidedById: me.id } });
  revalidatePath("/remote/approvals");
  revalidatePath("/remote");
  revalidatePath("/approvals");
}
