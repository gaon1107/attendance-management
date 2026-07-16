"use server";
// 인증방식 선택 / 생체정보 동의 / 철회 — 본인(직원)만.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { purgeUserPhotos } from "@/lib/clock-photo";
import { logAdminAction } from "@/lib/audit";

// 동의 해제 시 보관 중인 출퇴근 사진도 즉시 파기(동의 화면의 "철회 시 삭제" 약속 이행).
// 파기 실패가 철회 자체를 막으면 안 됨 — 로그만 남긴다(남은 파일은 90일 자동 파기가 처리).
// 반환값 = 실제로 파기에 성공했는지. 감사로그가 "성공"이라고 거짓말하지 않도록 호출부에 알린다.
async function purgePhotosSafely(userId: string): Promise<boolean> {
  try {
    await purgeUserPhotos(userId);
    return true;
  } catch (e) {
    console.error("[authmethod] 동의 철회 사진 파기 실패(철회는 정상 처리됨):", e);
    return false;
  }
}

// 생체정보를 실제로 갖고 있었는지 — "지울 게 없었는데 파기했다"는 가짜 감사기록을 막는 판단 기준.
// 서버 액션은 화면 없이도 직접 호출될 수 있으므로 화면 가드만 믿지 않는다.
function hadBiometric(u: { authMethod: string | null; faceConsentAt: Date | null }): boolean {
  return u.authMethod === "face" || u.faceConsentAt !== null;
}

// GPS(위치)만 사용 선택 — 얼굴 동의는 필요 없음.
export async function chooseGps(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const had = hadBiometric(me); // update 전에 판단해야 함(뒤에 보면 항상 없음으로 나옴)
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "gps", faceConsentAt: null }, // 얼굴에서 GPS로 바꾸면 동의도 해제
  });
  const purged = await purgePhotosSafely(me.id);
  // 감사로그 — ⚠️ 반드시 redirect 앞에. redirect()는 예외를 던져 뒤 코드를 실행하지 않는다.
  // 애초에 생체정보가 없던 사람(신입 등)이 GPS를 고른 것은 "파기"가 아니다 → 기록하지 않는다.
  if (had) await logAdminAction(me, "purge", "switch_to_gps", purged ? "success" : "fail");
  revalidatePath("/auth-method");
  redirect("/attendance");
}

// 생체정보(얼굴) 이용 동의 — 체크 후 제출. 동의 시각을 남기고 인증방식을 얼굴로.
export async function agreeBiometric(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "face", faceConsentAt: new Date() },
  });
  revalidatePath("/auth-method");
  redirect("/auth-method?consented=1");
}

// 동의 철회(삭제 요청) — 얼굴 사용 중단하고 GPS로 되돌린다.
// (실제 얼굴 데이터 삭제는 2단계에서 GaonFR unenrollment 연동)
export async function withdrawBiometric(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  const had = hadBiometric(me); // update 전에 판단
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "gps", faceConsentAt: null },
  });
  const purged = await purgePhotosSafely(me.id);
  // 감사로그 — ⚠️ 반드시 redirect 앞에. redirect()는 예외를 던져 뒤 코드를 실행하지 않는다.
  if (had) await logAdminAction(me, "purge", "self_withdraw", purged ? "success" : "fail");
  revalidatePath("/auth-method");
  redirect("/auth-method");
}

// 관리자 파기 — 특정 직원의 생체정보 동의를 파기(철회)한다. 반드시 내 회사 소속만(회사 격리).
// 퇴사 처리 등으로 관리자가 파기할 때 사용. (실제 얼굴 데이터 삭제는 2단계 GaonFR 연동)
export async function adminRevokeBiometric(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const userId = String(formData.get("userId") ?? "");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId } });
  if (!target) return;
  // 지울 생체정보가 없으면 아무 일도 하지 않는다 — 가짜 파기 기록 방지(화면 가드만 믿지 않음).
  if (!hadBiometric(target)) return;

  await prisma.user.update({
    where: { id: target.id },
    data: { authMethod: "gps", faceConsentAt: null },
  });
  const purged = await purgePhotosSafely(target.id);
  // 감사로그 — 관리자가 "누구의" 생체정보를 파기했는지가 핵심이라 대상을 함께 남긴다.
  //  · 이름 스냅샷 + 계정 id 병기: 동명이인이 있어도 누구인지 특정되고, 계정이 지워져도 이름이 남는다
  //    (AccessEvent.actorName이 이름 스냅샷을 남기는 것과 같은 방식).
  //  · 회사 격리 검사를 통과한 뒤이므로 내 회사 직원임이 보장된다.
  await logAdminAction(me, "purge", `admin_revoke:${target.name} (계정 ${target.id})`, purged ? "success" : "fail");
  revalidatePath("/biometrics");
}
