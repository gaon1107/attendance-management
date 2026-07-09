"use server";
// 얼굴 등록/삭제 — 본인(직원)만. 얼굴인증 동의자에 한함.
// FaceId=본인 id, Group=본인 회사 id(회사별 격리). 얼굴 원본은 우리 DB에 저장 안 함(얼굴서버에만).
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { enrollFace, unenrollFace, recognizeFace, isFaceConfigured } from "@/lib/face";
import { clockIn, clockOut } from "@/app/actions/attendance";

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

// [본인확인 공통] 웹캠 사진을 얼굴서버에 물어 "본인 얼굴"인지 확인한다.
// 성공 조건: 인식된 FaceId == 로그인한 직원 id (다른 사람 얼굴로 출퇴근 방지)
async function verifyMyFace(
  me: { id: string; companyId: string; authMethod: string | null; faceEnrolledAt: Date | null },
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  if (!isFaceConfigured()) return { ok: false, message: "얼굴서버 설정이 없습니다. 관리자에게 문의하세요." };
  if (me.authMethod !== "face" || !me.faceEnrolledAt) {
    return { ok: false, message: "얼굴인증 선택과 얼굴 등록이 먼저 필요합니다." };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "얼굴 사진이 없습니다. 다시 촬영해 주세요." };
  if (file.size > 900 * 1024) return { ok: false, message: "사진 용량이 너무 큽니다. 다시 시도해 주세요." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await recognizeFace(buffer, me.companyId);
  if (!result.success) {
    return { ok: false, message: result.message || "얼굴을 확인하지 못했습니다. 다시 시도해 주세요." };
  }
  if (result.faceId !== me.id) {
    // 같은 회사의 다른 직원 얼굴로 인식된 경우
    return { ok: false, message: "본인 얼굴로 확인되지 않았습니다. 본인만 화면에 나오도록 다시 시도해 주세요." };
  }
  return { ok: true, message: "본인 확인 완료" };
}

// [얼굴로 출근] 본인 확인 성공 시에만 기존 출근 처리(위치판정·중복방지 그대로)를 실행한다.
export async function faceClockIn(formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };

  const verified = await verifyMyFace(me, formData);
  if (!verified.ok) return { ok: false, message: verified.message };

  const rawMode = String(formData.get("mode") ?? "office");
  const mode = rawMode === "home" || rawMode === "field" ? rawMode : "office";
  // 좌표는 "보냈을 때만" 사용. (없는 값을 Number()로 바꾸면 0이 되어 엉뚱한 좌표(0,0)로 판정되는 것 방지)
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  const lat = latRaw === null ? NaN : Number(latRaw);
  const lng = lngRaw === null ? NaN : Number(lngRaw);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  await clockIn(mode, hasCoords ? lat : undefined, hasCoords ? lng : undefined);
  return { ok: true, message: "얼굴 확인 완료! 출근 처리되었습니다." };
}

// [얼굴로 퇴근] 본인 확인 성공 시에만 기존 퇴근 처리(외출 자동복귀 포함)를 실행한다.
export async function faceClockOut(formData: FormData): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, message: "로그인이 필요합니다." };

  const verified = await verifyMyFace(me, formData);
  if (!verified.ok) return { ok: false, message: verified.message };

  await clockOut();
  return { ok: true, message: "얼굴 확인 완료! 퇴근 처리되었습니다." };
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
