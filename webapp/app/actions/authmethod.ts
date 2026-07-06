"use server";
// 인증방식 선택 / 생체정보 동의 / 철회 — 본인(직원)만.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

// GPS(위치)만 사용 선택 — 얼굴 동의는 필요 없음.
export async function chooseGps(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "gps", faceConsentAt: null }, // 얼굴에서 GPS로 바꾸면 동의도 해제
  });
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
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "gps", faceConsentAt: null },
  });
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
  await prisma.user.update({
    where: { id: target.id },
    data: { authMethod: "gps", faceConsentAt: null },
  });
  revalidatePath("/biometrics");
}
