"use server";
// 사내 공지 작성/삭제 — 관리자만. 모든 직원이 열람만 한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function createNotice(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return { error: "제목과 내용을 모두 입력해주세요." };
  if (title.length > 100) return { error: "제목은 100자 이내로 입력해주세요." };

  await prisma.announcement.create({
    data: { companyId: me.companyId, title, body, authorName: me.name },
  });

  revalidatePath("/notice");
  return { ok: true };
}

// 공지 삭제 — 관리자만. 반드시 내 회사 공지만(회사 격리).
export async function deleteNotice(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const notice = await prisma.announcement.findFirst({ where: { id, companyId: me.companyId } });
  if (!notice) return;
  await prisma.announcement.delete({ where: { id: notice.id } });
  revalidatePath("/notice");
}
