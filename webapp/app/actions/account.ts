"use server";
// 계정 설정 — 비밀번호 변경(본인) + 회사 계정의 복구용 연락처 변경.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getCurrentUser, createSession } from "@/lib/session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { sendSms, smsConfigured } from "@/lib/sms";
import { isMobilePhone, toLocalPhone } from "@/lib/phone";
import { lockRemainMinutes, nextFailState } from "@/lib/login-policy";
import { headers } from "next/headers";
import { after } from "next/server";
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

// ═══════════════════════════════════════════════════════════════════════════
// 회사 계정(마스터 열쇠)의 **복구용 연락처** 변경 — 회사 계정 본인만.
//
// 왜 이 화면이 필요한가
//  · 회사 계정의 전화번호는 가입할 때 딱 한 번 기록되고, 그 뒤 **아무도 바꿀 수 없었다**(관리자는
//    lib/owner-rules.ts가 막고, 본인도 화면이 없었다). 이 "못 바꾼다"가 안전해 보이지만 뒤집으면
//    **담당자가 퇴사하거나 번호가 유출돼도 회수할 수 없다**는 뜻이다.
//    회사 열쇠를 되찾는 기준으로 쓰려면 회사가 스스로 갈아끼울 수 있어야 한다(2026-08-12 검수 치명 2).
//
// 🔒 뒷문을 만들지 않기 위한 규칙
//  ① **회사 계정 본인만.** 관리자·직원은 거부한다 — 관리자가 남의 복구 기준을 자기 번호로 바꾸는
//     경로가 생기면 그게 곧 회사 열쇠 탈취다(직원·관리자 연락처는 기존대로 관리자가 관리한다).
//  ② **현재 비밀번호 재확인.** 자리를 비운 사이 남이 조용히 갈아끼우지 못하게 한다.
//  ③ **옛 번호로 변경 통지.** 몰래 바뀌면 원래 담당자가 즉시 안다(탐지 장치).
//  ④ **진행 중인 인증번호 전부 폐기.** 옛 번호로 이미 나간 코드로 되찾는 창을 닫는다.
//  ⑤ 문자를 실제로 받을 수 있는 휴대폰만 허용(lib/phone.ts isMobilePhone).
// ═══════════════════════════════════════════════════════════════════════════
/** 번호 변경 최소 간격 — 24시간 1회. */
const PHONE_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function changeRecoveryPhone(
  _prev: { error?: string; ok?: boolean; notified?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean; notified?: boolean }> {
  const me = await getCurrentUser();
  if (!me) return { error: "로그인이 필요합니다." };
  // ① 회사 계정 본인만. 다른 계정은 이 창구를 아예 쓸 수 없다.
  if (!me.isOwner) {
    return { error: "이 기능은 회사 계정에서만 사용할 수 있습니다." };
  }

  const current = String(formData.get("current") ?? "");
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  if (!current || !phoneRaw) return { error: "현재 비밀번호와 새 연락처를 모두 입력해주세요." };
  if (current.length > 200) return { error: "현재 비밀번호가 올바르지 않습니다." };

  // 🔒 비밀번호 잠금은 로그인과 **같은 기준**을 쓴다(검수 M-2).
  //    안 그러면 세션을 훔친 자가 이 창구에서 로그인 잠금을 우회해 비밀번호를 무제한으로 찍는다.
  const remain = lockRemainMinutes(me.lockedUntil);
  if (remain !== null) {
    return { error: `비밀번호를 여러 번 잘못 입력했습니다. 약 ${remain}분 뒤에 다시 시도해주세요.` };
  }

  // ⑤ 문자를 받을 수 있는 번호인가 — 유선·가상번호는 여기서 막는다(이유는 lib/phone.ts 주석).
  if (!isMobilePhone(phoneRaw)) {
    return { error: "문자를 받을 수 있는 휴대폰 번호를 입력해주세요. (예: 010-1234-5678)" };
  }

  const { ip, userAgent } = readClientMeta(await headers());

  // ② 현재 비밀번호 재확인. 틀리면 **기록을 남기고** 로그인과 같은 방식으로 횟수를 센다.
  if (!verifyPassword(current, me.passwordHash)) {
    await prisma.user.update({ where: { id: me.id }, data: nextFailState(me.failedLoginCount) });
    await recordAccess({
      companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
      kind: "config", result: "fail", ip, userAgent, meta: "owner_recovery_phone_change",
    });
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }

  const next = toLocalPhone(phoneRaw);
  const before = toLocalPhone(me.phone);
  if (next === before) return { error: "지금 등록된 연락처와 같습니다." };

  // 🔒 24시간 1회 제한(검수 치명 1).
  //    없으면 "번호를 A로 바꾸고 → B로 바꾸면 A에게 문자 1통"을 무한 반복해 **아무 번호로나
  //    문자를 계속 쏘는 발송기**가 된다(건당 과금 + 우리 발신번호가 스팸으로 쓰인다).
  const since = me.phoneChangedAt ? Date.now() - me.phoneChangedAt.getTime() : Infinity;
  if (since < PHONE_CHANGE_COOLDOWN_MS) {
    const hours = Math.max(1, Math.ceil((PHONE_CHANGE_COOLDOWN_MS - since) / 3600000));
    return { error: `복구용 연락처는 하루에 한 번만 바꿀 수 있습니다. 약 ${hours}시간 뒤에 다시 시도해주세요.` };
  }

  const now = new Date();
  // ③④ 번호 교체 + 진행 중인 인증번호 폐기 + 다른 기기 로그아웃을 한 묶음으로.
  //  · 인증번호 폐기: 지금은 회사 계정에 코드가 발급되지 않아 실제로는 0건이다. 로드맵 ③에서
  //    복구가 열리면 "옛 번호로 이미 나간 코드"를 닫는 장치가 된다(미리 넣어 둔다).
  //  · 세션 정리: 복구 기준 변경은 비밀번호 변경에 준하는 보안 사건이다. 비밀번호 변경이 전 세션을
  //    끊는 것과 같은 이유로(검수 M-14·M-7) 다른 기기를 끊고 이 기기만 다시 로그인 상태로 만든다.
  await prisma.$transaction([
    prisma.user.update({ where: { id: me.id }, data: { phone: next, phoneChangedAt: now } }),
    prisma.passwordResetCode.updateMany({
      where: { userId: me.id, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    }),
    prisma.session.deleteMany({ where: { userId: me.id } }),
  ]);
  await createSession(me.id, { role: me.role, isOwner: me.isOwner });

  // 감사기록 — 회사 열쇠의 복구 기준이 바뀌는 일이라 반드시 남긴다.
  //  ⚠️ 번호 값 자체는 남기지 않는다(사규 8). "바뀌었다"는 사실과 누가 했는지만.
  await recordAccess({
    companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
    kind: "config", result: "success", ip, userAgent, meta: "owner_recovery_phone_change",
  });

  // ③ 옛 번호로 변경 통지 — **탐지 장치**다. 몰래 바뀌면 원래 담당자가 즉시 안다.
  //  · 옛 번호가 없거나(최초 등록) 문자 설정 전이면 보내지 않는다 → `notified: false`로 알려
  //    화면이 "보냈습니다"라고 거짓말하지 않게 한다(검수 M-1).
  //  · ⚠️ 본문에 **새 번호를 넣지 않는다**(검수 M-4). 뒷 4자리는 복구 창구의 본인확인 값이라,
  //    넣으면 옛 번호 소지자(퇴사한 담당자)에게 그 값을 알려주는 꼴이 된다.
  //  · ⚠️ 회사명도 넣지 않는다 — 회사명은 관리자가 100자 임의 문자열로 바꿀 수 있어, 우리 발신번호로
  //    나가는 문자의 앞부분을 남이 쓰게 된다(검수 치명 1 · 기존 M-21과 같은 계열).
  const notify = !!before && smsConfigured();
  if (notify) {
    const text = "[근태관리] 회사 계정의 복구용 연락처가 다른 번호로 변경되었습니다. 본인이 하지 않았다면 즉시 확인해 주세요.";
    try {
      after(async () => {
        // 발송 기록을 남긴다 — 문자는 건당 비용이고, 남기지 않으면 추적이 불가능하다(검수 치명 1).
        let logId: string | null = null;
        try {
          const log = await prisma.smsLog.create({
            data: { companyId: me.companyId, userId: me.id, kind: "recovery_notice", refId: null, toNumber: before, result: "pending" },
            select: { id: true },
          });
          logId = log.id;
        } catch (e) {
          console.warn("[account] 통지 발송기록 생성 실패(발송은 진행):", e instanceof Error ? e.message : String(e));
        }
        const res = await sendSms({ to: before, text });
        if (!res.ok) console.error("[account] 복구용 연락처 변경 통지 실패:", res.detail);
        if (logId) {
          try {
            await prisma.smsLog.update({
              where: { id: logId },
              data: res.ok ? { result: "success", detail: null } : { result: "fail", detail: res.detail.slice(0, 200) },
            });
          } catch (e) {
            console.error("[account] 통지 결과 기록 실패:", e instanceof Error ? e.message : String(e));
          }
        }
      });
    } catch (e) {
      console.error("[account] 변경 통지 예약 실패:", e instanceof Error ? e.message : String(e));
    }
  }

  revalidatePath("/account");
  return { ok: true, notified: notify };
}
