"use server";
// 첫 사용 안내(온보딩 투어) 확인 처리 — 봤다고 표시하면 다시 띄우지 않는다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function markTourSeen(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  await prisma.user.update({ where: { id: me.id }, data: { tourSeenAt: new Date() } });
  revalidatePath("/attendance");
}
