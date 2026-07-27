"use server";
// 인증방식 선택 / 생체정보 동의 / 철회 — 본인(직원)만.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { purgeUserPhotos } from "@/lib/clock-photo";
import { logAdminAction } from "@/lib/audit";
import { unenrollFace } from "@/lib/face";

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

// 얼굴서버(GaonFR)에 등록된 얼굴 원본을 삭제한다(생체정보 파기의 마지막 조각).
// 등록이 없었으면(wasEnrolled=false) 지울 것도 없으므로 성공으로 본다.
// 삭제 실패가 파기(철회) 자체를 막으면 안 됨 — 예외를 삼키고 결과(bool)만 호출부에 알린다(purgePhotosSafely와 동일 방어).
// 반환값 = "얼굴서버에 남은 얼굴이 없음이 보장되는가". (deleteMyFace의 unenroll 호출과 같은 규칙: FaceId=직원 id, Group=회사 id)
//
// ⚠️ lib/face.ts의 unenrollFace에는 요청 타임아웃이 없다(recognize/detect엔 있음). GaonFR이 연결만 받고
//    응답을 주지 않는 "행(hang)" 상태면 예외 없이 무한 대기 → catch가 못 잡고 철회 화면이 멈춘다.
//    공통모듈(face.ts)은 건드리지 않고 여기서 10초 상한을 걸어 "삭제 실패가 파기를 막지 않는다"는 약속을 지킨다.
//    (상한 초과 시 false → 로컬 등록표시는 남겨 다음 파기 때 재시도. 뒤늦게 끝나는 fetch는 무시해도 무해.)
async function unenrollFaceSafely(userId: string, companyId: string, wasEnrolled: boolean): Promise<boolean> {
  if (!wasEnrolled) return true; // 등록된 얼굴이 없으면 지울 것도 없음
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ success: false; message: string }>((resolve) => {
      timer = setTimeout(() => resolve({ success: false, message: "얼굴서버 응답 시간 초과(10초)" }), 10_000);
    });
    const r = await Promise.race([unenrollFace(userId, companyId), timeout]);
    if (!r.success) console.error("[authmethod] 얼굴서버 원본 삭제 실패(파기는 정상 처리됨):", r.message);
    return r.success;
  } catch (e) {
    console.error("[authmethod] 얼굴서버 원본 삭제 오류(파기는 정상 처리됨):", e);
    return false;
  } finally {
    if (timer) clearTimeout(timer); // 먼저 끝나면 남은 타이머 정리(대량 파기 시 타이머 누적 방지)
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
  // 🔒 회사 계정은 사람이 아니다 — 얼굴·인증방식을 가질 수 없다(검수 2차 3).
  if (me.isOwner) return;
  const had = hadBiometric(me); // update 전에 판단해야 함(뒤에 보면 항상 없음으로 나옴)
  const wasEnrolled = me.faceEnrolledAt !== null; // update 전에 캡처(얼굴서버에 지울 원본이 있는지)
  // 얼굴서버 원본을 먼저 지운다 — 실패하면 로컬 등록표시(faceEnrolledAt)를 남겨 재시도 경로를 유지한다.
  //  (DB부터 지우면 "우리 표시는 미등록인데 서버엔 얼굴이 남는" 최악의 잔존이 조용히 굳는다.)
  const unenrolled = await unenrollFaceSafely(me.id, me.companyId, wasEnrolled);
  await prisma.user.update({
    where: { id: me.id },
    // 얼굴에서 GPS로 바꾸면 동의는 항상 해제. 등록표시는 GaonFR 삭제가 성공했을 때만 해제(유령 "등록됨" 방지+재시도 보존).
    data: { authMethod: "gps", faceConsentAt: null, ...(unenrolled ? { faceEnrolledAt: null, faceEnrollCount: 0 } : {}) },
  });
  const purged = await purgePhotosSafely(me.id);
  // 감사로그 — ⚠️ 반드시 redirect 앞에. redirect()는 예외를 던져 뒤 코드를 실행하지 않는다.
  // 애초에 생체정보가 없던 사람(신입 등)이 GPS를 고른 것은 "파기"가 아니다 → 기록하지 않는다.
  // 로컬 사진·GaonFR 원본이 모두 지워져야 "성공" — 하나라도 실패면 fail(원칙 ④: 사실대로).
  if (had) await logAdminAction(me, "purge", "switch_to_gps", purged && unenrolled ? "success" : "fail");
  revalidatePath("/auth-method");
  redirect("/attendance");
}

// 생체정보(얼굴) 이용 동의 — 체크 후 제출. 동의 시각을 남기고 인증방식을 얼굴로.
export async function agreeBiometric(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  // 🔒 회사 계정은 사람이 아니다 — 얼굴·인증방식을 가질 수 없다(검수 2차 3).
  if (me.isOwner) return;
  const 재동의 = me.faceConsentAt !== null; // 처음 동의인지 재동의인지 — 감사에서 구분되어야 함
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "face", faceConsentAt: new Date() },
  });
  // 감사로그 — 민감정보 "수집 개시" 시점을 남긴다. User.faceConsentAt은 현재 상태값이라
  // 재동의하면 덮여서 과거 이력이 사라지므로, 이력은 접속기록(2년 보관)에만 남는다.
  // ⚠️ 반드시 redirect 앞에. redirect()는 예외를 던져 뒤 코드를 실행하지 않는다.
  await logAdminAction(me, "config", 재동의 ? "biometric_reconsent" : "biometric_consent");
  revalidatePath("/auth-method");
  redirect("/auth-method?consented=1");
}

// 동의 철회(삭제 요청) — 얼굴 사용 중단하고 GPS로 되돌린다.
// 로컬 사진 파기 + 얼굴서버(GaonFR) 원본 삭제까지 함께 처리한다.
export async function withdrawBiometric(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  // 🔒 회사 계정은 사람이 아니다 — 얼굴·인증방식을 가질 수 없다(검수 2차 3).
  if (me.isOwner) return;
  const had = hadBiometric(me); // update 전에 판단
  const wasEnrolled = me.faceEnrolledAt !== null; // update 전에 캡처(얼굴서버에 지울 원본이 있는지)
  // 얼굴서버 원본을 먼저 지운다 — 실패하면 등록표시를 남겨 재시도 경로를 유지(chooseGps와 동일 규칙).
  const unenrolled = await unenrollFaceSafely(me.id, me.companyId, wasEnrolled);
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "gps", faceConsentAt: null, ...(unenrolled ? { faceEnrolledAt: null, faceEnrollCount: 0 } : {}) },
  });
  const purged = await purgePhotosSafely(me.id);
  // 감사로그 — ⚠️ 반드시 redirect 앞에. redirect()는 예외를 던져 뒤 코드를 실행하지 않는다.
  // 로컬 사진·GaonFR 원본이 모두 지워져야 "성공"(원칙 ④: 사실대로).
  if (had) await logAdminAction(me, "purge", "self_withdraw", purged && unenrolled ? "success" : "fail");
  revalidatePath("/auth-method");
  redirect("/auth-method");
}

// 관리자 파기 — 특정 직원의 생체정보 동의를 파기(철회)한다. 반드시 내 회사 소속만(회사 격리).
// 퇴사 처리 등으로 관리자가 파기할 때 사용. 로컬 사진 + 얼굴서버(GaonFR) 원본까지 삭제한다.
export async function adminRevokeBiometric(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return;
  const userId = String(formData.get("userId") ?? "");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId } });
  if (!target) return;
  const wasEnrolled = target.faceEnrolledAt !== null; // update 전에 캡처(얼굴서버에 지울 원본이 있는지)
  // 지울 생체정보가 없으면 아무 일도 하지 않는다 — 가짜 파기 기록 방지(화면 가드만 믿지 않음).
  //  단, 동의는 없는데 얼굴서버 등록이 남은 "고아 상태"(이전 삭제 실패 등)면 원본 정리를 위해 계속 진행한다.
  if (!hadBiometric(target) && !wasEnrolled) return;

  // 얼굴서버 원본을 먼저 지운다 — 실패하면 등록표시를 남겨 재시도 경로를 유지(chooseGps와 동일 규칙).
  const unenrolled = await unenrollFaceSafely(target.id, target.companyId, wasEnrolled);
  await prisma.user.update({
    where: { id: target.id },
    data: { authMethod: "gps", faceConsentAt: null, ...(unenrolled ? { faceEnrolledAt: null, faceEnrollCount: 0 } : {}) },
  });
  const purged = await purgePhotosSafely(target.id);
  // 감사로그 — 관리자가 "누구의" 생체정보를 파기했는지가 핵심이라 대상을 함께 남긴다.
  //  · 이름 스냅샷 + 계정 id 병기: 동명이인이 있어도 누구인지 특정되고, 계정이 지워져도 이름이 남는다
  //    (AccessEvent.actorName이 이름 스냅샷을 남기는 것과 같은 방식).
  //  · 회사 격리 검사를 통과한 뒤이므로 내 회사 직원임이 보장된다.
  //  · 로컬 사진·GaonFR 원본이 모두 지워져야 "성공"(원칙 ④: 사실대로).
  await logAdminAction(me, "purge", `admin_revoke:${target.name} (계정 ${target.id})`, purged && unenrolled ? "success" : "fail");
  revalidatePath("/biometrics");
}
