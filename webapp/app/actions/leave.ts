"use server";
// 휴가 신청/취소(직원) + 승인/반려·연차부여(관리자).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { effectiveWorkDays } from "@/lib/workdays";
import { loadOffDays } from "@/lib/holiday-server";
import { REQUESTABLE_TYPES, isSingleDayLeave, leaveTypeDeducts, computeLeaveDays, parseYmd, usedLeaveDays } from "@/lib/leave";

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

  // 내 근무요일(회사 기본 또는 개인 예외)
  const company = await prisma.company.findUnique({ where: { id: me.companyId }, select: { workDays: true, holidayAutoOn: true } });
  const wd = effectiveWorkDays(me.workDays, company?.workDays);
  // 신청 기간의 쉬는 날(공휴일·회사휴무일)은 연차 차감에서 제외한다.
  const offDays = await loadOffDays(me.companyId, company?.holidayAutoOn ?? true, start, end);

  const days = computeLeaveDays(type, start, end, wd, offDays);
  // 조퇴는 연차 차감이 없어 days=0이 정상 → 근무일수 검사에서 제외한다. (그 외는 근무일이 0이면 신청 무의미)
  if (type !== "early_leave" && days <= 0) return { error: "선택한 기간에 근무일이 없습니다. 근무요일을 확인해주세요." };

  // 연차·반차는 잔여를 넘을 수 없다(병가는 차감 안 함).
  if (leaveTypeDeducts(type)) {
    const mine = await prisma.leaveRequest.findMany({
      where: { userId: me.id, companyId: me.companyId },
      select: { type: true, days: true, status: true },
    });
    const remaining = me.annualLeaveDays - usedLeaveDays(mine);
    if (days > remaining) {
      return { error: `잔여 연차(${remaining}일)보다 많이 신청했습니다. (${days}일 신청)` };
    }
  }

  await prisma.leaveRequest.create({
    data: { companyId: me.companyId, userId: me.id, type, startDate: start, endDate: end, days, reason },
  });

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
  await prisma.leaveRequest.delete({ where: { id: lv.id } });
  revalidatePath("/leave");
}

// 관리자: 휴가 승인. 반드시 내 회사 신청만(회사 격리).
export async function approveLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const lv = await prisma.leaveRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!lv) return;
  await prisma.leaveRequest.update({ where: { id: lv.id }, data: { status: "approved", decidedAt: new Date() } });
  revalidatePath("/leave/approvals");
  revalidatePath("/leave");
}

// 관리자: 휴가 반려.
export async function rejectLeave(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const lv = await prisma.leaveRequest.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!lv) return;
  await prisma.leaveRequest.update({ where: { id: lv.id }, data: { status: "rejected", decidedAt: new Date() } });
  revalidatePath("/leave/approvals");
  revalidatePath("/leave");
}

// 관리자: 직원 연차 부여 일수 설정(직원 상세). 회사 격리.
export async function setAnnualLeave(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const id = String(formData.get("id") ?? "");
  const days = Number(formData.get("days"));
  if (Number.isNaN(days) || days < 0 || days > 365) return { error: "연차 일수는 0~365일 사이로 입력해주세요." };

  const target = await prisma.user.findFirst({ where: { id, companyId: me.companyId } });
  if (!target) return { error: "직원을 찾을 수 없습니다." };

  await prisma.user.update({ where: { id: target.id }, data: { annualLeaveDays: days } });
  revalidatePath(`/employees/${id}`);
  return { ok: true };
}
