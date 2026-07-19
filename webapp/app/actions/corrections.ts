"use server";
// 근태 정정 요청(직원) + 승인/반려(관리자).
// 승인하면 그 날짜의 출퇴근 기록(Attendance)에 실제로 반영한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseYmd } from "@/lib/leave";
import { isValidHm, hmToDate } from "@/lib/corrections";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps } from "@/lib/approval-server";

// 직원: 근태 정정 요청. 날짜 + (출근/퇴근 중 하나 이상) + 사유.
export async function requestCorrection(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const targetDate = parseYmd(String(formData.get("targetDate") ?? ""));
  if (!targetDate) return { error: "정정할 날짜를 선택해주세요." };

  const inRaw = String(formData.get("requestedIn") ?? "").trim();
  const outRaw = String(formData.get("requestedOut") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!inRaw && !outRaw) return { error: "출근·퇴근 시각 중 최소 하나는 입력해주세요." };
  if (inRaw && !isValidHm(inRaw)) return { error: "출근 시각 형식이 올바르지 않습니다. (예: 09:00)" };
  if (outRaw && !isValidHm(outRaw)) return { error: "퇴근 시각 형식이 올바르지 않습니다. (예: 18:00)" };
  if (inRaw && outRaw && outRaw <= inRaw) return { error: "퇴근 시각이 출근 시각보다 빠르거나 같습니다." };
  if (!reason) return { error: "정정 사유를 입력해주세요." };

  const created = await prisma.attendanceCorrection.create({
    data: {
      companyId: me.companyId,
      userId: me.id,
      targetDate,
      requestedIn: inRaw || null,
      requestedOut: outRaw || null,
      reason,
    },
  });
  // 부서장 결재선을 켠 회사면 결재 단계 생성(아니면 관리자 단일 승인).
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { approvalMode: true, approvalStepCount: true } });
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "correction", created.id);

  revalidatePath("/corrections");
  return { ok: true };
}

// 직원: 대기 중인 내 요청 취소.
export async function cancelCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, userId: me.id, status: "pending" } });
  if (!c) return;
  await deleteApprovalSteps(me.companyId, "correction", c.id); // 결재 단계도 함께 정리
  await prisma.attendanceCorrection.delete({ where: { id: c.id } });
  revalidatePath("/corrections");
  revalidatePath("/approvals");
}

// 정정 승인 → 체인 완료 시 그 날짜의 출퇴근 기록에 반영. 회사 격리.
//  · 단일 승인=관리자만, 부서장 결재선=현재 단계 결재자(또는 관리자). 기록 반영은 최종 승인 1회만.
export async function approveCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!c) return;

  const result = await advanceApproval(me, "correction", c.id, "approve");
  if (result === "denied") return;
  if (result !== "approved") {
    // "advanced" → 다음 결재자 대기. 기록 반영·상태 변경 없음.
    revalidatePath("/corrections/approvals");
    revalidatePath("/corrections");
    revalidatePath("/approvals");
    return;
  }

  // 여기부터는 체인 완료(최종 승인) → 실제 기록 반영.
  // 그 날짜 범위 [자정, 다음날 자정)
  const dayStart = c.targetDate;
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const newIn = c.requestedIn ? hmToDate(dayStart, c.requestedIn) : null;
  const newOut = c.requestedOut ? hmToDate(dayStart, c.requestedOut) : null;

  // 상태 선점 + 기록 반영을 한 트랜잭션으로 원자화 →
  //  ① 동시 최종승인/재시도에도 status:"pending" 가드로 정확히 1회만 반영(출근레코드 이중 생성 방지)
  //  ② 반영 도중 실패 시 전체 롤백(status는 pending으로 남아 재시도 가능)
  await prisma.$transaction(async (tx) => {
    const claim = await tx.attendanceCorrection.updateMany({
      where: { id: c.id, companyId: me.companyId, status: "pending" },
      data: { status: "approved", decidedAt: new Date() },
    });
    if (claim.count !== 1) return; // 이미 다른 결재자가 확정 → 기록 반영 생략

    const existing = await tx.attendance.findFirst({
      where: { userId: c.userId, companyId: c.companyId, clockIn: { gte: dayStart, lt: dayEnd } },
      orderBy: { clockIn: "asc" },
    });
    if (existing) {
      // 기존 기록 수정: 입력된 값만 반영(안 준 값은 그대로).
      await tx.attendance.update({
        where: { id: existing.id },
        data: { ...(newIn ? { clockIn: newIn } : {}), ...(newOut ? { clockOut: newOut } : {}) },
      });
    } else if (newIn) {
      // 기록이 없던 날 = 새로 만든다(출근 시각이 있어야 만들 수 있음).
      await tx.attendance.create({
        data: { userId: c.userId, companyId: c.companyId, clockIn: newIn, clockOut: newOut, workMode: "office" },
      });
    }
    // (기록도 없고 출근 시각도 안 준 경우는 반영할 대상이 없어 상태만 승인 처리)
  });

  revalidatePath("/corrections/approvals");
  revalidatePath("/corrections");
  revalidatePath("/records");
  revalidatePath("/approvals");
}

// 정정 반려 — 어느 단계든 반려하면 반려 확정. 회사 격리.
export async function rejectCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!c) return;
  const result = await advanceApproval(me, "correction", c.id, "reject");
  if (result === "denied") return;
  await prisma.attendanceCorrection.updateMany({ where: { id: c.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date() } });
  revalidatePath("/corrections/approvals");
  revalidatePath("/corrections");
  revalidatePath("/approvals");
}
