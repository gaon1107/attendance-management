"use server";
// 휴가 신청/취소(직원) + 승인/반려·연차부여(관리자).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { effectiveWorkDays } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { REQUESTABLE_TYPES, isSingleDayLeave, leaveTypeDeducts, computeLeaveDays, parseYmd, usedLeaveDays, annualLeaveGranted } from "@/lib/leave";
import { createApprovalStepsIfNeeded, advanceApproval, deleteApprovalSteps } from "@/lib/approval-server";

// 직원: 휴가 신청. 종류·기간을 받아 근무요일 기준 사용일수를 계산하고 대기 상태로 만든다.
export async function requestLeave(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const type = String(formData.get("type") ?? "");
  if (!(REQUESTABLE_TYPES as readonly string[]).includes(type)) return { error: "휴가 종류를 선택해주세요." };

  const start = parseYmd(String(formData.get("startDate") ?? ""));
  const endRaw = String(formData.get("endDate") ?? "");
  const singleDay = isSingleDayLeave(type); // 반차(오전·오후)·병가·조퇴는 하루짜리(종료일 없음)
  // 여러 날짜 종류(연차 등)는 종료일 필수 — 빈 값이 조용히 "당일"로 처리되지 않게 명시적으로 막는다.
  if (!singleDay && !parseYmd(endRaw)) return { error: "종료일을 선택해주세요." };
  const end = singleDay ? start : parseYmd(endRaw) ?? start;
  if (!start || !end) return { error: "날짜를 올바르게 선택해주세요." };
  if (end < start) return { error: "종료일이 시작일보다 빠릅니다." };

  const reason = String(formData.get("reason") ?? "").trim() || null;

  // 내 근무요일(회사 기본 또는 개인 예외) + 결재방식
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { workDays: true, holidayAutoOn: true, approvalMode: true, approvalStepCount: true } });
  const wd = effectiveWorkDays(me.workDays, company?.workDays);
  // 신청 기간의 쉬는 날(공휴일·회사휴무일)은 연차 차감에서 제외한다.
  const offDays = await loadOffDays(me.companyId, company?.holidayAutoOn ?? true, start, end);

  const days = computeLeaveDays(type, start, end, wd, offDays);
  // 조퇴는 연차 차감이 없어 days=0이 정상 → 근무일수 검사에서 제외한다. (그 외는 근무일이 0이면 신청 무의미)
  if (type !== "early_leave" && days <= 0) return { error: "선택한 기간에 근무일이 없습니다. 근무요일을 확인해주세요." };

  // 무차감 다일 휴가(경조·공가·특별)는 잔여 한도가 없어 상한이 없다 → 1회 신청 근무일수 상한으로 비정상 장기신청을 막는다.
  //  (연차·반차는 아래 잔여검사로 제한됨. 조퇴·병가는 하루라 이 상한에 걸리지 않음.)
  const MAX_NONDEDUCT_DAYS = 60;
  if (!leaveTypeDeducts(type) && days > MAX_NONDEDUCT_DAYS) {
    return { error: `한 번에 신청할 수 있는 근무일수(${MAX_NONDEDUCT_DAYS}일)를 넘었습니다. 기간을 나눠 신청해주세요.` };
  }

  // 연차·반차는 잔여를 넘을 수 없다(병가는 차감 안 함).
  if (leaveTypeDeducts(type)) {
    const mine = await prisma.leaveRequest.findMany({
      where: { userId: me.id, companyId: me.companyId },
      select: { type: true, days: true, status: true },
    });
    const remaining = annualLeaveGranted(me) - usedLeaveDays(mine);
    if (days > remaining) {
      return { error: `잔여 연차(${remaining}일)보다 많이 신청했습니다. (${days}일 신청)` };
    }
  }

  const created = await prisma.leaveRequest.create({
    data: { companyId: me.companyId, userId: me.id, type, startDate: start, endDate: end, days, reason },
  });
  // 부서장 결재선을 켠 회사면 결재 단계를 생성(비결재선/결재자 없음이면 만들지 않음=관리자 단일 승인).
  await createApprovalStepsIfNeeded(company, me.companyId, me.id, me.departmentId, "leave", created.id);

  revalidatePath("/leave");
  return { ok: true };
}

// 직원: 대기 중인 내 신청 취소(삭제). 이미 승인/반려된 건 취소 불가.
export async function cancelLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const lv = await prisma.leaveRequest.findFirst({ where: { id, userId: me.id, status: "pending" } });
  if (!lv) return;
  await deleteApprovalSteps(me.companyId, "leave", lv.id); // 결재 단계도 함께 정리(고아 방지)
  await prisma.leaveRequest.delete({ where: { id: lv.id } });
  revalidatePath("/leave");
  revalidatePath("/approvals");
}

// 휴가 승인 — 회사 격리. 단일 승인이면 관리자만, 부서장 결재선이면 현재 단계 결재자(또는 관리자 오버라이드).
//  · 전 단계가 끝나 체인이 완료될 때만 원본 status를 approved로 바꾼다(그전엔 pending 유지 → 소비처 회귀 0).
export async function approveLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const lv = await prisma.leaveRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!lv) return;
  const result = await advanceApproval(me, "leave", lv.id, "approve");
  if (result === "denied") return;
  if (result === "approved") {
    // status:"pending" 가드 → 동시/재시도에도 한 번만 확정(멱등).
    await prisma.leaveRequest.updateMany({ where: { id: lv.id, companyId: me.companyId, status: "pending" }, data: { status: "approved", decidedAt: new Date() } });
  }
  // "advanced" → 다음 결재자 대기, 원본은 pending 유지
  revalidatePath("/leave/approvals");
  revalidatePath("/leave");
  revalidatePath("/approvals");
}

// 휴가 반려 — 회사 격리. 어느 단계든 반려하면 원본을 반려 확정한다.
export async function rejectLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const lv = await prisma.leaveRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!lv) return;
  const result = await advanceApproval(me, "leave", lv.id, "reject");
  if (result === "denied") return;
  await prisma.leaveRequest.updateMany({ where: { id: lv.id, companyId: me.companyId, status: "pending" }, data: { status: "rejected", decidedAt: new Date() } });
  revalidatePath("/leave/approvals");
  revalidatePath("/leave");
  revalidatePath("/approvals");
}

// 관리자: 직원 연차 수동조정(override) 설정/해제(직원 상세). 회사 격리.
//  · auto=1  → override를 null로 지워 입사일 기준 자동계산으로 되돌린다.
//  · 그 외    → 입력한 일수를 override로 저장(특별부여/감액). 자동값보다 우선.
export async function setAnnualLeave(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  // 자동계산으로 되돌리기(수동조정 해제)
  if (String(formData.get("auto") ?? "") === "1") {
    await prisma.user.update({ where: { id: target.id }, data: { annualLeaveOverride: null } });
    revalidatePath(`/employees/${id}`);
    return { ok: true };
  }

  const days = Number(formData.get("days"));
  if (Number.isNaN(days) || days < 0 || days > 365) return { error: "연차 일수는 0~365일 사이로 입력해주세요." };

  await prisma.user.update({ where: { id: target.id }, data: { annualLeaveOverride: days } });
  revalidatePath(`/employees/${id}`);
  return { ok: true };
}
