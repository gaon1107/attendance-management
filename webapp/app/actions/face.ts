"use server";
// 얼굴 등록/삭제 — 본인(직원)만. 얼굴인증 동의자에 한함.
// FaceId=본인 id, Group=본인 회사 id(회사별 격리). 얼굴 원본은 우리 DB에 저장 안 함(얼굴서버에만).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { enrollFace, unenrollFace, isFaceConfigured } from "@/lib/face";

type ActionResult = { ok: boolean; message: string; count?: number };

const MAX_ENROLL = 3; // 각도를 다르게 최대 3회까지 등록(인식 정확도 향상)

// 내 얼굴 등록 — 웹캠으로 찍은 사진(FormData "image")을 얼굴서버에 등록한다.
export async function enrollMyFace(formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };
  if (!isFaceConfigured()) return { ok: false, message: "얼굴서버 설정이 없습니다. 관리자에게 문의하세요." };
  // 얼굴인증을 선택하고 생체정보에 동의한 사람만 등록 가능(강제 아님·동의 우선)
  if (me.authMethod !== "face" || !me.faceConsentAt) {
    return { ok: false, message: "먼저 [인증방식]에서 얼굴인증 선택과 생체정보 동의가 필요합니다." };
  }
  // 최대 3회까지만 등록
  if (me.faceEnrollCount >= MAX_ENROLL) {
    return { ok: false, message: `이미 최대 ${MAX_ENROLL}회까지 등록되어 있습니다.`, count: me.faceEnrollCount };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "얼굴 사진이 없습니다. 다시 촬영해 주세요." };
  // 안전장치: 너무 큰 이미지 거부(서버액션 1MB 제한). 화면에서 이미 축소해 보냄.
  if (file.size > 900 * 1024) return { ok: false, message: "사진 용량이 너무 큽니다. 다시 시도해 주세요." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await enrollFace(buffer, me.id, me.companyId);
  if (!result.success) {
    return { ok: false, message: result.message || "얼굴 등록에 실패했습니다. 밝은 곳에서 정면으로 다시 시도해 주세요." };
  }

  const newCount = Math.min(MAX_ENROLL, me.faceEnrollCount + 1);
  await prisma.user.update({ where: { id: me.id }, data: { faceEnrolledAt: new Date(), faceEnrollCount: newCount } });
  revalidatePath("/face-enroll");
  revalidatePath("/attendance");
  return { ok: true, message: `${newCount}번째 얼굴 등록 완료`, count: newCount };
}

// 내 얼굴 등록 삭제 — 얼굴서버에서 지우고 표시도 해제. (다시 등록 가능)
export async function deleteMyFace(): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };
  if (me.faceEnrolledAt) {
    await unenrollFace(me.id, me.companyId).catch(() => null); // 서버 삭제 실패해도 우리 표시는 해제(재시도 가능)
  }
  await prisma.user.update({ where: { id: me.id }, data: { faceEnrolledAt: null, faceEnrollCount: 0 } });
  revalidatePath("/face-enroll");
  revalidatePath("/attendance");
  return { ok: true, message: "얼굴 등록이 삭제되었습니다." };
}
