"use server";
// 계정 설정 — 비밀번호 변경(본인). 현재 비밀번호 확인 후 새 비밀번호로 교체한다.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getCurrentUser, createSession } from "@/lib/session";
import { revalidatePath } from "next/cache";

export async function changePassword(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  // allowMustChange: 임시 비밀번호를 새 비밀번호로 바꾸는 액션 자체(9-C — 기본 차단이면 영영 못 바꾼다).
  const me = await getCurrentUser({ allowMustChange: true });
  if (!me) return { error: "로그인이 필요합니다." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next || !confirm) return { error: "모든 항목을 입력해주세요." };
  if (next.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };
  if (next !== confirm) return { error: "새 비밀번호 확인이 일치하지 않습니다." };
  if (!verifyPassword(current, me.passwordHash)) return { error: "현재 비밀번호가 올바르지 않습니다." };
  if (current === next) return { error: "새 비밀번호가 현재 비밀번호와 같습니다." };
  // 🔒 만료된 임시 비밀번호는 "현재 비밀번호"로도 못 쓴다(9-C 검수 경미 1).
  //    48시간 만료는 로그인 시(auth.ts)에만 걸려 있어서, 만료 전에 얻어둔 세션으로
  //    며칠 뒤 이 화면에 오면 만료된 임시 비밀번호로 변경이 됐다. 로그인과 같은 기준으로 막는다.
  if (me.mustChangePassword && me.tempPasswordExpiresAt && me.tempPasswordExpiresAt < new Date()) {
    return { error: "임시 비밀번호의 사용 기한(48시간)이 지났습니다. 비밀번호 재설정을 다시 요청해주세요." };
  }

  // 비밀번호를 바꾸면 "임시 비밀번호 → 변경 강제" 표시와 만료 시각도 함께 내려준다(정상 변경도 무해).
  await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash: hashPassword(next), mustChangePassword: false, tempPasswordExpiresAt: null },
  });

  // 🔒 비밀번호를 바꾸면 **기존 로그인 세션을 모두 끊고** 지금 이 기기만 다시 로그인 상태로 만든다(검수 M-14).
  //   비밀번호를 바꾸는 가장 큰 이유가 "누가 내 계정에 들어와 있는 것 같다"인데,
  //   예전에는 세션을 안 끊어서 훔쳐간 쪽이 30일간 그대로 쓸 수 있었다.
  //   (관리자가 비번을 재설정하는 경로는 이미 세션을 끊고 있었고, 본인 변경만 빠져 있었다)
  await prisma.session.deleteMany({ where: { userId: me.id } });
  await createSession(me.id);

  revalidatePath("/account");
  return { ok: true };
}
