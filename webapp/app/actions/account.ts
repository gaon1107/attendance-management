"use server";
// 계정 설정 — 비밀번호 변경(본인). 현재 비밀번호 확인 후 새 비밀번호로 교체한다.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function changePassword(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next || !confirm) return { error: "모든 항목을 입력해주세요." };
  if (next.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };
  if (next !== confirm) return { error: "새 비밀번호 확인이 일치하지 않습니다." };
  if (!verifyPassword(current, me.passwordHash)) return { error: "현재 비밀번호가 올바르지 않습니다." };
  if (current === next) return { error: "새 비밀번호가 현재 비밀번호와 같습니다." };

  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: hashPassword(next) } });

  revalidatePath("/account");
  return { ok: true };
}
