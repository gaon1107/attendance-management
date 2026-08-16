"use server";
// 계정 설정 — 비밀번호 변경(본인) + 회사 계정의 복구용 연락처 변경.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getCurrentUser, createSession } from "@/lib/session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { sendSms, smsConfigured } from "@/lib/sms";
import { isMobilePhone, toLocalPhone, formatPhone } from "@/lib/phone";
import { lockRemainMinutes, recordFail, recordSuccess, PASSWORD_MAX_LEN, PASSWORD_INPUT_HARD_LIMIT } from "@/lib/login-policy";
import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";

// ═══════════════════════════════════════════════════════════════════════════
// 본인 비밀번호 변경. 두 화면이 쓴다:
//   · [계정 설정]의 비밀번호 변경 카드 (모든 사용자)
//   · [임시 비밀번호 강제 변경] 화면 (임시 비밀번호를 받은 직원이 반드시 거치는 길)
//
// 🔴 여기는 **비밀번호를 확인하는 창구**다 — 로그인과 똑같은 방어가 필요하다(2026-08-16 검수 치명).
//    예전에는 잠금 확인도, 실패 횟수 집계도, 감사기록도, 길이 상한도 **하나도 없었다.**
//    그래서 자리를 비운 사이 브라우저를 잡거나 세션을 훔친 사람이 이 창구를 반복 호출해
//    **비밀번호를 무제한으로 찍을 수 있었다.** 계정이 이미 잠겨 있어도 여기서는 계속 찍혔다.
//    알아낸 비밀번호로 아래 [복구용 연락처]까지 갈아끼울 수 있어, 그쪽에 정교하게 만든
//    5회 잠금·감사기록·1분 간격이 **통째로 우회되는** 경로였다.
// ═══════════════════════════════════════════════════════════════════════════
export async function changePassword(
  _prev: { error?: string; ok?: boolean; relogin?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean; relogin?: boolean }> {
  // allowMustChange: 임시 비밀번호를 새 비밀번호로 바꾸는 액션 자체(9-C — 기본 차단이면 영영 못 바꾼다).
  const me = await getCurrentUser({ allowMustChange: true });
  if (!me) return { error: "로그인이 필요합니다." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next || !confirm) return { error: "모든 항목을 입력해주세요." };
  // 🔒 길이 상한 — 없으면 본문 크기만큼 긴 문자열에도 scrypt가 돌아 **서버 전체가 멈춘다**
  //    (1회 약 40ms 동안 다른 요청이 전부 대기). 로그인은 이미 막고 있는데 이 창구만 열려 있으면
  //    로그인을 막은 의미가 없다(auth.ts 검수 2차 치명 2와 같은 위협).
  //  ⚠️ **"현재 비밀번호"와 "새 비밀번호"의 상한이 다르다 — 일부러 그렇다**(재검수 M-1).
  //     현재 비밀번호에까지 정책값(200)을 걸었더니, 과거에 200자 넘는 비밀번호로 가입한 사람이
  //     **스스로 고칠 마지막 길**이 막혔다. 회사 계정이 그 처지가 되면 재설정 경로가 둘 다 막혀 있어
  //     결과가 "회사 영구 잠금"이다. 대조용 입력은 넉넉히 받고, 새로 정하는 값만 정책으로 조인다.
  if (current.length > PASSWORD_INPUT_HARD_LIMIT) {
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }
  if (next.length > PASSWORD_MAX_LEN) {
    return { error: `새 비밀번호는 ${PASSWORD_MAX_LEN}자 이하로 입력해주세요.` };
  }
  if (next.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };
  if (next !== confirm) return { error: "새 비밀번호 확인이 일치하지 않습니다." };

  // 🔒 잠금 확인 — 로그인과 **같은 기준·같은 함수**를 쓴다.
  //    ⚠️ 비밀번호를 대조하기 **전에** 검사한다. 잠긴 계정에까지 scrypt를 태우면
  //       제한이 CPU를 한 푼도 아껴주지 못해, 제한 자체가 서비스 마비 통로가 된다.
  const lockMins = lockRemainMinutes(me.lockedUntil);
  if (lockMins !== null) {
    return { error: `비밀번호를 여러 번 잘못 입력했습니다. 약 ${lockMins}분 뒤에 다시 시도해주세요.` };
  }

  const { ip, userAgent } = readClientMeta(await headers());

  if (!verifyPassword(current, me.passwordHash)) {
    // 실패를 **로그인과 같은 창구**로 센다(lib/login-policy.ts). 5회면 10분 잠금.
    //  · 이 창구와 로그인은 같은 칸(failedLoginCount·lockedUntil)을 쓰므로, 한쪽에서 잠기면
    //    다른 쪽도 함께 막힌다 — 창구를 갈아타며 찍는 우회가 불가능하다.
    await recordFail(prisma, me);
    // 🔴 기록의 종류를 **`login_fail`로 남긴다**(재검수 M-3). `config`(설정 변경)로 남기면
    //    [이상접속] 알림·[차단 후보] 집계·[로그인 이력] 화면이 전부 `login_fail`만 세기 때문에
    //    **비밀번호를 찍는 공격이 감시망에 한 번도 안 잡힌다.** 기록은 남는데 아무도 모르는 상태다.
    //    무슨 창구였는지는 meta로 구분된다.
    await recordAccess({
      companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
      kind: "login_fail", result: "fail", ip, userAgent, meta: "password_change_denied",
    });
    // 5회째에 잠겼다면 **그 자리에서 알려준다**(재검수 경미 2).
    //  · 안 알려주면 사용자는 6번째 시도에서야 잠긴 걸 안다. 특히 [임시 비밀번호 강제 변경] 화면은
    //    잠기는 순간 그 화면도 로그인 화면도 함께 막혀 10분간 갇히므로, 이유를 바로 말해줘야 한다.
    //  · 로그인 창구에서는 이렇게 못 한다(계정이 실재한다는 사실이 새어 나간다). 여기는 이미
    //    본인 세션으로 들어와 있는 사람이라 숨길 것이 없다.
    const after = await prisma.user.findUnique({ where: { id: me.id }, select: { lockedUntil: true } });
    const nowLocked = lockRemainMinutes(after?.lockedUntil);
    if (nowLocked !== null) {
      return { error: `비밀번호를 여러 번 잘못 입력했습니다. 약 ${nowLocked}분 뒤에 다시 시도해주세요.` };
    }
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }
  // 비밀번호가 맞았으면 실패 기록을 되돌린다(로그인 성공 처리와 동일).
  //  · 안 되돌리면 여기서 쌓인 횟수가 남아, 며칠 뒤 **로그인에서 한 번만 틀려도** 즉시 잠긴다.
  if (me.failedLoginCount !== 0 || me.lockedUntil) {
    await recordSuccess(prisma, me.id);
  }

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

  // 감사기록 — 남의 계정을 들여다보던 사람이 비밀번호를 바꿔 잠가버리는 일이 실제로 있다.
  //  ⚠️ 비밀번호 값은 절대 남기지 않는다(사규 8). "바뀌었다"는 사실과 누가 했는지만.
  await recordAccess({
    companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
    kind: "config", result: "success", ip, userAgent, meta: "password_change",
  });

  // 🔒 세션 재발급 — **실패해도 비밀번호는 이미 바뀌었다.**
  //    여기가 [복구용 연락처] 쪽보다 훨씬 위험하다: 거기는 비밀번호가 그대로라 다시 로그인하면 되지만,
  //    여기는 **옛 비밀번호가 이미 무효**다. "실패했다"고만 말하면 사용자는 새 비밀번호를 쓸 생각을
  //    못 한 채 로그아웃된 상태로 남는다. 사실대로 "바뀌었으니 새 비밀번호로 다시 로그인하라"고 한다.
  // ⚠️ 역할을 반드시 넘긴다(재검수 중간 1). 안 넘기면 createSession이 다시 조회하는데, 그 조회가
  //    실패하면 **가장 짧은 정책(7일 + 12시간 유휴)**으로 떨어진다. 회사 계정이 그 정책을 타면
  //    lib/session.ts가 "절대 안 된다"고 못박은 상태(평소 안 쓰는 계정이 유휴 만료로 잠김)가 된다.
  try {
    await createSession(me.id, { role: me.role, isOwner: me.isOwner });
  } catch (e) {
    console.error("[account] 비밀번호 변경 후 세션 재발급 실패:", e instanceof Error ? e.message : String(e));
    return { ok: true, relogin: true };
  }

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
//  ⑥ **저장 전에 전체 번호를 보여주고 한 번 더 확인받는다**(2단계). 아래 "왜 2단계인가" 참조.
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 왜 2단계 확인인가 — 앞선 설계가 스스로 만든 구멍(검수 N-1)
//    저장된 번호는 `010-****-5678`로 가려 보여준다. 그래서 **가운데 네 자리를 잘못 쳐도 눈에 안 띈다.**
//    거기에 "하루 1회" 제한까지 걸어 두었더니, 오타를 알아차려도 24시간 되돌릴 수 없었다.
//    통지 문자는 *옛 번호*로 가므로 "틀렸다"는 신호도 오지 않는다.
//    → 복구용 연락처가 틀렸다는 건 곧 **회사 열쇠를 영영 못 찾는다**는 뜻이라, 이 조합이 제일 위험했다.
//    → 가리기 전에 전체 번호를 보여주고 확인받고, 제한 기준도 아래처럼 바꿨다.
//
// 🔴 제한 기준을 "변경 횟수"에서 "문자 발송 건수"로 옮긴 이유
//    막고 싶은 것은 **문자 폭탄과 그 요금**이지 사용자의 번호 정정이 아니다.
//    문자가 나가지 않는 변경(최초 등록·문자 미연동·옛 번호가 유선)은 비용이 0이므로 막을 이유가 없다.
//    · 실제로 발송한 건수(SmsLog) 기준 24시간 3건 — 오타 정정 여유를 남기면서 폭탄은 막는다.
//    · 여기에 **1분 최소 간격**을 DB가 원자적으로 강제한다(아래 updateMany). 동시에 수십 건이 들어와도
//      통과하는 건 딱 하나다 — "읽고 판단해서 쓰기"는 동시 요청 앞에서 전부 뚫린다(검수 N-3,
//      이 저장소가 반복해서 치명으로 잡아온 패턴).
// ═══════════════════════════════════════════════════════════════════════════
/** 번호 변경 최소 간격 — 연타·동시 요청 방어. DB가 원자적으로 강제한다. */
const PHONE_CHANGE_MIN_INTERVAL_MS = 60 * 1000;
/**
 * **같은 번호 한 대에** 24시간 동안 보낼 수 있는 통지 최대 건수(스팸 방어).
 *
 * 🔴 왜 "사용자당"이 아니라 "받는 번호당"인가(재재검수 중간 3)
 *    막고 싶은 것은 **한 사람의 폰에 문자가 쏟아지는 것**이다. 사용자당으로 세면 엉뚱한 사람이 맞는다:
 *    공격자가 세션을 훔쳐 번호를 세 번 갈아끼우면 상한이 다 차고, 첫 문자를 받고 달려온 진짜 담당자가
 *    **24시간 동안 번호를 되돌리지 못한다.** 상한이 공격자가 아니라 방어자를 때리는 것이다.
 *    받는 번호 기준이면 A→B→C→D는 A·B·C가 각 1통이라 아무도 폭탄을 맞지 않고 정정도 막히지 않는다.
 *    원래 막으려던 "A↔B 무한 반복 발송기"는 각 번호가 3통에서 멈추므로 그대로 차단된다.
 */
const MAX_NOTICES_PER_NUMBER = 3;
/**
 * 한 계정이 24시간에 시도할 수 있는 통지 발송 **총 횟수**(요금·API 천장).
 *  · 실패는 과금이 없어 위 상한에 안 잡히므로, 발송사가 죽었을 때 무한히 두드리는 것을 여기서 막는다.
 *  · 공격자가 3번 바꿔도 7번이 남으므로 담당자의 사고 대응을 막지 않는다.
 */
const MAX_NOTICE_ATTEMPTS_PER_DAY = 10;
const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 이 시간이 지나도 `pending`인 기록은 "결과 불명"으로 보고 요금 상한에서 뺀다(서버가 멈춘 흔적). */
const PENDING_GRACE_MS = 10 * 60 * 1000;
/** SmsLog.kind — 이 값으로 발송 건수를 센다. 바꾸면 제한이 조용히 풀리니 한 곳에서만 쓴다. */
const NOTICE_KIND = "recovery_notice";

type RecoveryPhoneState = {
  error?: string;
  ok?: boolean;
  /** 옛 번호 통지 결과 — "sent"(발송 요청함) | "skipped"(보낼 이유 없음) | "failed"(우리 쪽 오류로 못 보냄) */
  notified?: "sent" | "skipped" | "failed";
  /** 값이 있으면 "이 번호가 맞습니까?" 확인 단계. 가리지 않은 전체 번호(예: 010-1234-5678). */
  confirm?: string;
  /** 번호는 바뀌었는데 세션 재발급이 실패한 상태. 화면은 다시 로그인하라고 안내한다(검수 N-4). */
  relogin?: boolean;
};

export async function changeRecoveryPhone(
  _prev: RecoveryPhoneState,
  formData: FormData
): Promise<RecoveryPhoneState> {
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
  //    ⚠️ 감사기록의 meta는 성공과 **다른 값**을 쓴다(검수 경미 2) — 같은 값이면 [접속기록]에서
  //       실패 시도까지 "연락처 변경 5건"처럼 읽혀, 진짜 변경이 몇 번이었는지 알 수 없다.
  //    ⚠️ 실패 기록은 `recordFail`(조건부 갱신)로 남긴다 — 그냥 update로 쓰면 **로그인 쪽에서 방금 걸린
  //       잠금을 이 창구가 지워버린다**(재검수 치명 1). 두 창구가 같은 칸을 쓰므로 반드시 같은 함수를 쓴다.
  if (!verifyPassword(current, me.passwordHash)) {
    await recordFail(prisma, me);
    await recordAccess({
      companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
      kind: "config", result: "fail", ip, userAgent, meta: "owner_recovery_phone_denied",
    });
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }

  // 🔒 비밀번호가 맞았으면 실패 기록을 되돌린다 — 로그인 성공 처리와 **같은 창구**를 쓴다(재검수 중간 5).
  //    안 되돌리면 "여기서 4번 틀리고 5번째에 성공" 뒤에 그 4가 남아, 며칠 뒤 **로그인에서 딱 한 번**
  //    오타를 냈을 때 곧바로 10분 잠긴다. 사용자는 이유를 알 방법이 없다.
  if (me.failedLoginCount !== 0 || me.lockedUntil) {
    await recordSuccess(prisma, me.id);
  }

  const next = toLocalPhone(phoneRaw);
  const before = toLocalPhone(me.phone);
  if (next === before) return { error: "지금 등록된 연락처와 같습니다." };

  const now = new Date();

  // ⑥ **확인 단계** — 아직 아무것도 저장하지 않는다.
  //    화면이 돌려준 값(confirmed)이 지금 입력한 번호와 정확히 같을 때만 저장으로 넘어간다.
  //    다르면(=확인 뒤에 번호를 고쳤다면) 다시 확인을 받는다.
  //
  //    ⚠️ **이 단계는 오타 방지 장치이지 보안 통제가 아니다.** confirmed 값을 직접 넣어 건너뛸 수 있고,
  //       막을 필요도 없다 — 우회해봐야 "본인이 확인 화면을 안 보고 자기 번호를 저장"할 뿐이다.
  //       여기에 권한·인증 판단을 얹지 말 것. 그런 판단은 전부 위쪽(본인확인·비밀번호·잠금)에 있다.
  const confirmed = toLocalPhone(String(formData.get("confirmed") ?? ""));
  if (confirmed !== next) {
    return { confirm: formatPhone(next) };
  }

  // 🔒 통지 문자 하루 상한 — **실제로 보낸 건수**로 센다.
  //    ⚠️ 실패(result="fail")는 과금이 없으므로 세지 않는다. 막힌 시도를 세면 "문자 한 통 못 받고
  //       24시간 잠기는" 사고가 난다(2026-08-10에 같은 유형을 이미 겪었다).
  //    · 상한에 닿으면 **변경 자체를 거부**한다. "변경은 해주고 통지만 생략"하면 공격자가 통지 3건을
  //      태워버린 뒤 조용히 번호를 갈아끼우는 경로가 된다 — 탐지 장치가 꺼지는 쪽이 훨씬 위험하다.
  // 🔴 통지를 보낼 조건에 **옛 번호가 휴대폰인가**를 넣는다(재재검수 중간 1).
  //    빠뜨렸을 때: 가입 때 대표번호(02·070)를 넣어둔 회사 — 즉 카드가 "이 번호로는 문자를 받을 수
  //    없습니다"라고 경고하던 바로 그 회사 — 가 번호를 바꾸면 그 유선번호로 문자를 쏜다.
  //    아이원24는 응답 본문이 비면 성공으로 치므로(lib/sms.ts) **과금까지 되고**, 화면은
  //    "발송 요청했습니다"라고 안심시킨다. 실제로는 아무도 못 받는다 = 탐지 장치가 없는 것과 같다.
  const willNotify = isMobilePhone(before) && smsConfigured();
  if (willNotify) {
    const windowStart = new Date(now.getTime() - NOTICE_WINDOW_MS);
    const [toThisNumber, attempts] = await Promise.all([
      // ① **이 번호 한 대가** 최근 24시간에 받은(또는 받았을 수 있는) 건수.
      //    ⚠️ `pending`을 무조건 세면 안 된다(재검수 중간 3). 발송 직전에 서버가 멈추면 그 행은
      //       **영원히 pending으로 남고**, 3번 그러면 문자 한 통 안 나갔는데 24시간 잠긴다.
      //       "막힌 시도를 세지 않는다"는 이 저장소의 원칙(2026-08-10 사고)이 pending에도 그대로 적용된다.
      //       → 갓 만들어진 pending(발송 진행 중)만 센다. 오래된 pending은 결과 불명이므로 세지 않는다.
      prisma.smsLog.count({
        where: {
          companyId: me.companyId, userId: me.id, kind: NOTICE_KIND,
          toNumber: before, createdAt: { gte: windowStart },
          OR: [
            { result: { in: ["success", "unknown"] } },
            { result: "pending", createdAt: { gte: new Date(now.getTime() - PENDING_GRACE_MS) } },
          ],
        },
      }),
      // ② 발송 "시도" 총 횟수 — 실패는 과금이 없지만 공짜는 아니다(재검수 중간 3).
      //    발송사가 죽어 계속 fail이 나면 ①이 전혀 차지 않아, 1분 간격만으로 하루 1,440번
      //    발송사 API를 두드리고 SmsLog를 쌓을 수 있다. 그 천장을 따로 둔다.
      prisma.smsLog.count({ where: { companyId: me.companyId, userId: me.id, kind: NOTICE_KIND, createdAt: { gte: windowStart } } }),
    ]);
    // 문구를 나눈다 — "너무 여러 번 바꿨습니다"는 ②에서는 거짓말이다(두 번밖에 안 바꿨을 수 있다).
    if (toThisNumber >= MAX_NOTICES_PER_NUMBER) {
      return { error: "지금 등록된 번호로 이미 안내 문자를 여러 번 보냈습니다. 24시간 뒤에 다시 시도해주세요." };
    }
    if (attempts >= MAX_NOTICE_ATTEMPTS_PER_DAY) {
      return { error: "안내 문자 발송이 하루 한도에 도달했습니다. 24시간 뒤에 다시 시도해주세요." };
    }
  }

  // ③④ 번호 교체 + 진행 중인 인증번호 폐기 + 다른 기기 로그아웃을 한 묶음으로.
  //  · 🔒 번호 교체는 **조건부 updateMany 한 방**이다(검수 N-3). "읽어서 판단하고 쓰기"였다면
  //    동시에 들어온 요청이 전부 같은 값을 읽고 전부 통과해, 최소 간격이 통째로 무력화된다.
  //    조건을 where에 넣으면 DB가 딱 한 건만 성공시킨다(count===0 = 내가 진 쪽 = 거부).
  //  · 마지막 조건은 **서버 시계가 되감겼을 때** 영구히 잠기지 않게 하는 안전밸브다.
  //    🔴 기준을 그냥 `gt: now`로 두면 안 된다(검증에서 실제로 뚫렸다 — 동시 10건 중 4건 통과).
  //       동시에 들어온 요청들은 각자 몇 ms 다른 `now`를 들고 있어서, 먼저 저장한 쪽의 시각이
  //       뒤늦게 판정하는 쪽 눈에는 "미래"로 보인다 → 밸브가 열려 최소 간격이 통째로 무력화된다.
  //       그래서 **최소 간격만큼 더 미래**일 때만 이상으로 본다(ms 단위 흔들림과 진짜 시계 되감김을 가른다).
  //  · 인증번호 폐기: 지금은 회사 계정에 코드가 발급되지 않아 실제로는 0건이다. 로드맵 ③에서
  //    복구가 열리면 "옛 번호로 이미 나간 코드"를 닫는 장치가 된다(미리 넣어 둔다).
  //  · 세션 정리: 복구 기준 변경은 비밀번호 변경에 준하는 보안 사건이다. 비밀번호 변경이 전 세션을
  //    끊는 것과 같은 이유로(검수 M-14·M-7) 다른 기기를 끊고 이 기기만 다시 로그인 상태로 만든다.
  const cutoff = new Date(now.getTime() - PHONE_CHANGE_MIN_INTERVAL_MS);
  const clockSkewed = new Date(now.getTime() + PHONE_CHANGE_MIN_INTERVAL_MS);
  const saved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: {
        id: me.id,
        OR: [{ phoneChangedAt: null }, { phoneChangedAt: { lt: cutoff } }, { phoneChangedAt: { gt: clockSkewed } }],
      },
      data: { phone: next, phoneChangedAt: now },
    });
    if (claimed.count === 0) return false;
    await tx.passwordResetCode.updateMany({
      where: { userId: me.id, usedAt: null, invalidatedAt: null },
      data: { invalidatedAt: now },
    });
    await tx.session.deleteMany({ where: { userId: me.id } });
    return true;
  });
  if (!saved) {
    return { error: "방금 연락처를 바꿨습니다. 잠시 후 다시 시도해주세요." };
  }

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
  //  · 대신 **사업자등록번호 뒤 5자리**를 넣는다(검수 N-7). 어느 회사인지 모르면 "어디서 온 문자야?"
  //    하고 무시돼 탐지 장치가 작동하지 않는다. 이 값은 10자리 숫자 체크섬 검증을 통과해야만
  //    저장되므로(actions/company.ts), 임의 문구를 문자 앞에 끼워 넣는 악용이 불가능하다.
  //  · 결과는 **3가지로 구분해** 화면에 넘긴다(재검수 중간 2). 예전엔 참/거짓 둘뿐이라, 발송기록
  //    생성이 DB 오류로 실패해도 화면이 "최초 등록이거나 문자가 연결되지 않았습니다"라는 **정상적인
  //    이유**를 댔다. 탐지 장치가 꺼진 사실이 정상처럼 보이면 아무도 조사하지 않는다.
  let notified: "sent" | "skipped" | "failed" = "skipped";
  if (willNotify) {
    const bizTail = (me.company.bizRegNo ?? "").replace(/[^0-9]/g, "").slice(-5);
    const who = bizTail.length === 5 ? `(사업자번호 뒤 ${bizTail}) ` : "";
    const text = `[근태관리] ${who}회사 계정의 복구용 연락처가 다른 번호로 변경되었습니다. 본인이 하지 않았다면 즉시 확인해 주세요.`;

    // 발송 기록을 **먼저, 응답 안에서** 만든다(검수 N-1).
    //  · 예전에는 after() 안에서 만들었다. 그러면 위 하루 상한이 세려는 바로 그 행이 응답 뒤에야
    //    생겨, 상한이 "있는데 안 세는" 상태가 될 수 있다. 셀 수 없는 문자는 보내지 않는다.
    let logId: string | null = null;
    try {
      const log = await prisma.smsLog.create({
        data: { companyId: me.companyId, userId: me.id, kind: NOTICE_KIND, refId: null, toNumber: before, result: "pending" },
        select: { id: true },
      });
      logId = log.id;
    } catch (e) {
      console.error("[account] 통지 발송기록 생성 실패(발송하지 않음):", e instanceof Error ? e.message : String(e));
      notified = "failed";
    }

    if (logId) {
      const sendId = logId;
      try {
        // 발송은 응답 밖으로 뺀다 — 발송사 응답이 느려도 화면이 기다리지 않게(검수 0-0-D 3번과 같은 이유).
        after(async () => {
          const res = await sendSms({ to: before, text });
          if (!res.ok) {
            console.error("[account] 복구용 연락처 변경 통지 실패:", res.detail);
            // 🔴 **사람이 볼 수 있는 곳에도 남긴다**(재재검수 중간 2). 발송사 장애·번호 해지로 통지가
            //    못 나가면 이 기능의 존재 이유(몰래 바뀌면 즉시 안다)가 조용히 꺼진다. 그런데 화면은
            //    이미 "발송 요청했습니다"를 보낸 뒤라, 서버 콘솔에만 남기면 아무도 모른다.
            //    → [접속기록]에 뜨게 해서 나중에라도 "그날 통지가 안 나갔다"를 확인할 수 있게 한다.
            try {
              await recordAccess({
                companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
                kind: "config", result: "fail", ip, userAgent, meta: "owner_recovery_notice_failed",
              });
            } catch (e) {
              console.error("[account] 통지 실패 감사기록 실패:", e instanceof Error ? e.message : String(e));
            }
          }
          try {
            await prisma.smsLog.update({
              where: { id: sendId },
              data: res.ok ? { result: "success", detail: null } : { result: "fail", detail: res.detail.slice(0, 200) },
            });
          } catch (e) {
            console.error("[account] 통지 결과 기록 실패:", e instanceof Error ? e.message : String(e));
          }
        });
        notified = "sent";
      } catch (e) {
        console.error("[account] 변경 통지 예약 실패:", e instanceof Error ? e.message : String(e));
        notified = "failed";
      }
    }
  }

  // 🔒 세션 재발급 — **실패해도 번호는 이미 바뀌었다**(검수 N-4).
  //    예전에는 여기서 예외가 나면 화면에 "실패"로 보였다. 그런데 실제로는 번호가 바뀌고 세션까지
  //    전부 끊긴 상태라, 사용자는 "실패했다니 다시 해야지" 하고 다시 로그인조차 못 한다.
  //    사실대로 "변경은 됐으니 다시 로그인하라"고 말하는 것이 유일하게 정직한 처리다.
  try {
    await createSession(me.id, { role: me.role, isOwner: me.isOwner });
  } catch (e) {
    console.error("[account] 연락처 변경 후 세션 재발급 실패:", e instanceof Error ? e.message : String(e));
    return { ok: true, notified, relogin: true };
  }

  revalidatePath("/account");
  return { ok: true, notified };
}
