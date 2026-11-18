"use server";
// 인증방식 선택 / 생체정보 동의 / 철회 — 본인(직원)만.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { purgeUserPhotos } from "@/lib/clock-photo";
import { logAdminAction } from "@/lib/audit";
import { unenrollFaceOutcome, unenrollAuditNote } from "@/lib/face-purge";

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

// 얼굴서버(GaonFR) 원본 삭제는 lib/face-purge.ts의 unenrollFaceOutcome을 쓴다(2026-11-19 옮김).
//   결과가 "failed"가 아닐 때만 등록 표시(faceEnrolledAt)를 지운다. 시간 상한·예외를 삼키는 규칙도 그쪽 주석 참조.
//   [5-2 검수 M3] 등록 표시가 없어도 생체정보 이력(had)이 있으면 삭제를 요청한다 — 표시 없이 서버에만 남은 얼굴까지 지우기 위해.
//   [5-2 검수 M2] 서버에 지울 얼굴이 없었으면(absent) 감사기록 상세에 그 사실을 남긴다.

// 감사기록 meta에 상세(괄호)를 붙인다 — 붙일 말이 없으면 이름만. 형식은 lib/access-labels.ts accessMetaLabel 참조.
function withDetail(name: string, parts: string[]): string {
  const d = parts.filter(Boolean).join(" · ");
  return d ? `${name} (${d})` : name;
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
  const outcome = await unenrollFaceOutcome(me.id, me.companyId, { enrolled: wasEnrolled, history: had });
  const unenrolled = outcome !== "failed";
  await prisma.user.update({
    where: { id: me.id },
    // 얼굴에서 GPS로 바꾸면 동의는 항상 해제. 등록표시는 GaonFR 삭제가 성공했을 때만 해제(유령 "등록됨" 방지+재시도 보존).
    data: { authMethod: "gps", faceConsentAt: null, ...(unenrolled ? { faceEnrolledAt: null, faceEnrollCount: 0 } : {}) },
  });
  const purged = await purgePhotosSafely(me.id);
  // 감사로그 — ⚠️ 반드시 redirect 앞에. redirect()는 예외를 던져 뒤 코드를 실행하지 않는다.
  // 애초에 생체정보가 없던 사람(신입 등)이 GPS를 고른 것은 "파기"가 아니다 → 기록하지 않는다.
  // 로컬 사진·GaonFR 원본이 모두 지워져야 "성공" — 하나라도 실패면 fail(원칙 ④: 사실대로).
  if (had) await logAdminAction(me, "purge", withDetail("switch_to_gps", [unenrollAuditNote(outcome)]), purged && unenrolled ? "success" : "fail");
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

  // 🔴 [5-2 검수 M1, 2026-11-19] 동의가 없는데 등록 얼굴 표시가 남아 있으면(퇴사·철회 때 얼굴서버 삭제 실패) 그 얼굴부터 지운다.
  //    그대로 동의를 받으면 파기됐어야 할 옛 얼굴로 곧바로 얼굴 출퇴근이 되고, [생체정보]의 '얼굴 남음' 표시도 사라진다
  //    (예: 퇴사 때 삭제 실패 → 복직 → 재동의). 지우지 못하면 동의를 받지 않고 동의 화면에 안내한다.
  const leftover = me.faceConsentAt === null && me.faceEnrolledAt !== null;
  if (leftover) {
    const o = await unenrollFaceOutcome(me.id, me.companyId, { enrolled: true, history: true });
    if (o === "failed") {
      await logAdminAction(me, "purge", withDetail("consent_leftover_cleanup", [unenrollAuditNote(o)]), "fail");
      redirect("/consent?error=face_left"); // 예외를 던져 여기서 끝난다 — 아래 동의 저장은 실행되지 않는다
    }
    // 옛 얼굴은 지웠다(또는 서버에 없었다) → 새로 등록하도록 등록 표시도 함께 지운다(아래 동의 저장과 한 번에).
    await logAdminAction(me, "purge", withDetail("consent_leftover_cleanup", [unenrollAuditNote(o)]), "success");
  }

  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "face", faceConsentAt: new Date(), ...(leftover ? { faceEnrolledAt: null, faceEnrollCount: 0 } : {}) },
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
  const outcome = await unenrollFaceOutcome(me.id, me.companyId, { enrolled: wasEnrolled, history: had });
  const unenrolled = outcome !== "failed";
  await prisma.user.update({
    where: { id: me.id },
    data: { authMethod: "gps", faceConsentAt: null, ...(unenrolled ? { faceEnrolledAt: null, faceEnrollCount: 0 } : {}) },
  });
  const purged = await purgePhotosSafely(me.id);
  // 감사로그 — ⚠️ 반드시 redirect 앞에. redirect()는 예외를 던져 뒤 코드를 실행하지 않는다.
  // 로컬 사진·GaonFR 원본이 모두 지워져야 "성공"(원칙 ④: 사실대로).
  if (had) await logAdminAction(me, "purge", withDetail("self_withdraw", [unenrollAuditNote(outcome)]), purged && unenrolled ? "success" : "fail");
  revalidatePath("/auth-method");
  redirect("/auth-method");
}

// 관리자 파기 — 특정 직원의 생체정보 동의를 파기(철회)한다. 반드시 내 회사 소속만(회사 격리).
// 동의가 있는 재직자: 동의 철회 → 로컬 사진 + 얼굴서버(GaonFR) 원본까지 삭제한다.
// 퇴사자·동의가 이미 없는 '얼굴 남음': 얼굴서버 원본만 삭제하고 출퇴근 사진은 남긴다(아래 C1 주석).
// 폼 값 photos="purge"는 관리자가 확인창에서 "사진도 지운다"를 보고 동의했다는 표시다(BiometricsList.tsx).
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

  // 이 [파기]가 실제로 동의를 철회하는가 — 재직 중이고 동의가 있을 때만. (update 전에 판단해야 함)
  const withdrawsConsent = target.deactivatedAt === null && target.faceConsentAt !== null;
  const confirmedPurge = String(formData.get("photos") ?? "") === "purge";

  // 얼굴서버 원본을 먼저 지운다 — 실패하면 등록표시를 남겨 재시도 경로를 유지(chooseGps와 동일 규칙).
  const outcome = await unenrollFaceOutcome(target.id, target.companyId, { enrolled: wasEnrolled, history: hadBiometric(target) });
  const unenrolled = outcome !== "failed";
  await prisma.user.update({
    where: { id: target.id },
    data: { authMethod: "gps", faceConsentAt: null, ...(unenrolled ? { faceEnrolledAt: null, faceEnrollCount: 0 } : {}) },
  });
  // 🔴 [5-2 검수 치명 C1 + 재검수 중간 1·2, 2026-11-19] 출퇴근 사진은 "이 [파기]가 동의를 철회할 때"만 지운다.
  //    · 퇴사자 사진은 동의 내용대로 90일 보관 뒤 자동 삭제(근태 분쟁 대비, 2026-11-19 사장님 결정) — 퇴사 처리 때와 같은 규칙.
  //      예전엔 퇴사자의 '얼굴 남음'을 [파기]로 다시 지우면 사진까지 즉시 지워졌다.
  //    · 동의가 이미 없는 '얼굴 남음'(예: 퇴사 때 얼굴서버 삭제 실패 → 복직)도 철회할 것이 없으므로 사진을 건드리지 않는다.
  //      그 사진은 퇴사 때 90일 보관하기로 한 바로 그 사진일 수 있다. (본인 철회·GPS 전환은 그 순간 이미 사진을 지웠다.)
  //    · 동의가 있는 재직자의 [파기]는 본인 철회와 같으므로 사진도 즉시 지운다(동의 화면 "철회 시 삭제" 약속).
  //    · 세 가지가 **모두** 맞을 때만 지운다. 하나라도 어긋나면 남기는 쪽(되돌릴 수 없는 삭제를 피함):
  //      ① 관리자가 확인창에서 본 범위가 "사진도 삭제"(photos=purge) — 오래 열어 둔 화면에서 그사이 상태가 바뀐 경우·화면 없는 직접 호출 대비
  //      ② 처음 읽은 상태가 "동의 있는 재직자"
  //      ③ 지우기 직전 다시 읽어도 재직 중 — 얼굴서버를 기다리는 사이(최대 15초) 다른 관리자가 퇴사 처리했을 수 있다
  const fresh = await prisma.user.findFirst({ where: { id: target.id, companyId: me.companyId }, select: { deactivatedAt: true } });
  const stillActive = fresh !== null && fresh.deactivatedAt === null;
  const purgePhotos = confirmedPurge && withdrawsConsent && stillActive;
  const purged = purgePhotos ? await purgePhotosSafely(target.id) : true;
  // 사진을 남긴 이유(감사기록용) — 나중에 "왜 사진이 남았나"를 기록만으로 답할 수 있게
  const keptReason = purgePhotos
    ? ""
    : target.deactivatedAt !== null || !stillActive
      ? "퇴사자 — 출퇴근 사진은 90일 보관 뒤 자동 삭제"
      : !withdrawsConsent
        ? "동의 없음 — 남은 얼굴만 정리, 출퇴근 사진은 90일 보관"
        : "확인한 범위와 달라 출퇴근 사진은 보관";
  // 감사로그 — 관리자가 "누구의" 생체정보를 파기했는지가 핵심이라 대상을 함께 남긴다.
  //  · 이름 스냅샷 + 계정 id 병기: 동명이인이 있어도 누구인지 특정되고, 계정이 지워져도 이름이 남는다
  //    (AccessEvent.actorName이 이름 스냅샷을 남기는 것과 같은 방식).
  //  · 회사 격리 검사를 통과한 뒤이므로 내 회사 직원임이 보장된다.
  //  · 로컬 사진·GaonFR 원본이 모두 지워져야 "성공"(원칙 ④: 사실대로).
  //  · 사진을 남긴 이유, 사진 삭제 실패도 함께 적는다(실패면 결과가 fail인데 이유가 없으면 기록만으로 알 수 없다 — 재검수 경미 2).
  const meta = withDetail(`admin_revoke:${target.name}`, [
    `계정 ${target.id}`,
    keptReason,
    purgePhotos && !purged ? "출퇴근 사진 삭제 실패" : "",
    unenrollAuditNote(outcome),
  ]);
  await logAdminAction(me, "purge", meta, purged && unenrolled ? "success" : "fail");
  revalidatePath("/biometrics");
}
