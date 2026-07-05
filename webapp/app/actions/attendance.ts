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
export async function clockOut(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (open) {
    await prisma.attendance.update({
      where: { id: open.id },
      data: { clockOut: new Date() },
    });
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}
