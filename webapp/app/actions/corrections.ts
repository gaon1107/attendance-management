"use server";
// 근태 정정 요청(직원) + 승인/반려(관리자).
// 승인하면 그 날짜의 출퇴근 기록(Attendance)에 실제로 반영한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { parseYmd } from "@/lib/leave";
import { isValidHm, hmToDate } from "@/lib/corrections";

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

  await prisma.attendanceCorrection.create({
    data: {
      companyId: me.companyId,
      userId: me.id,
      targetDate,
      requestedIn: inRaw || null,
      requestedOut: outRaw || null,
      reason,
    },
  });

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
  await prisma.attendanceCorrection.delete({ where: { id: c.id } });
  revalidatePath("/corrections");
}

// 관리자: 정정 승인 → 그 날짜의 출퇴근 기록에 반영. 회사 격리.
export async function approveCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!c) return;

  // 그 날짜 범위 [자정, 다음날 자정)
  const dayStart = c.targetDate;
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

  // 그 날 출근 기록(가장 이른 것) 찾기
  const existing = await prisma.attendance.findFirst({
    where: { userId: c.userId, companyId: c.companyId, clockIn: { gte: dayStart, lt: dayEnd } },
    orderBy: { clockIn: "asc" },
  });

  const newIn = c.requestedIn ? hmToDate(dayStart, c.requestedIn) : null;
  const newOut = c.requestedOut ? hmToDate(dayStart, c.requestedOut) : null;

  if (existing) {
    // 기존 기록 수정: 입력된 값만 반영(안 준 값은 그대로).
    await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        ...(newIn ? { clockIn: newIn } : {}),
        ...(newOut ? { clockOut: newOut } : {}),
      },
    });
  } else if (newIn) {
    // 기록이 없던 날 = 새로 만든다(출근 시각이 있어야 만들 수 있음).
    await prisma.attendance.create({
      data: {
        userId: c.userId,
        companyId: c.companyId,
        clockIn: newIn,
        clockOut: newOut,
        workMode: "office",
      },
    });
  }
  // (기록도 없고 출근 시각도 안 준 경우는 반영할 대상이 없어 상태만 승인 처리)

  await prisma.attendanceCorrection.update({ where: { id: c.id }, data: { status: "approved", decidedAt: new Date() } });
  revalidatePath("/corrections/approvals");
  revalidatePath("/corrections");
  revalidatePath("/records");
}

// 관리자: 정정 반려.
export async function rejectCorrection(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const c = await prisma.attendanceCorrection.findFirst({ where: { id, companyId: me.companyId, status: "pending" } });
  if (!c) return;
  await prisma.attendanceCorrection.update({ where: { id: c.id }, data: { status: "rejected", decidedAt: new Date() } });
  revalidatePath("/corrections/approvals");
  revalidatePath("/corrections");
}
