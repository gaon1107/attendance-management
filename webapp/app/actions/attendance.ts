"use server";
// 출퇴근 — 로그인한 본인의 출근/퇴근을 기록한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

// 출근 — 아직 퇴근 안 한 기록이 있으면(=이미 근무 중) 중복 생성하지 않는다.
export async function clockIn(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
  });
  if (!open) {
    await prisma.attendance.create({
      data: { userId: me.id, companyId: me.companyId },
    });
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// 퇴근 — 열려있는(퇴근 안 한) 가장 최근 출근 기록에 퇴근 시각을 채운다.
// 외출 중에 퇴근을 누르면 외출도 함께 종료한다.
export async function clockOut(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (open) {
    const now = new Date();
    // 열린 외출이 있으면 먼저 복귀 처리
    await prisma.break.updateMany({
      where: { attendanceId: open.id, endAt: null },
      data: { endAt: now },
    });
    await prisma.attendance.update({
      where: { id: open.id },
      data: { clockOut: now },
    });
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// 외출 시작 — 근무 중(출근했고 외출 안 한 상태)일 때만. 사유는 드롭다운에서 받는다.
export async function startBreak(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const reason = String(formData.get("reason") ?? "기타");

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open) return; // 출근 상태가 아니면 무시

  // 이미 외출 중이면 중복 생성 안 함
  const openBreak = await prisma.break.findFirst({
    where: { attendanceId: open.id, endAt: null },
  });
  if (!openBreak) {
    await prisma.break.create({ data: { attendanceId: open.id, reason } });
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// 복귀 — 열려있는 외출을 종료한다.
export async function endBreak(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open) return;

  await prisma.break.updateMany({
    where: { attendanceId: open.id, endAt: null },
    data: { endAt: new Date() },
  });

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}
