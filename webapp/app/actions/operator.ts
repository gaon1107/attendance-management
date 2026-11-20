"use server";
// 운영자(본사) 로그인 / 로그아웃.
//
// 🔴 이 파일은 **고객사 로그인(app/actions/auth.ts)을 건드리지 않는다.** 대신 그 파일이 검수를 거쳐
//    쌓아 온 방어 순서를 **그대로 따라 한다.** 순서 자체가 방어라서, 편의로 바꾸면 구멍이 생긴다:
//      ① 길이 상한 검사 → ② IP 시도 제한 **판정만** → ③ 비밀번호 대조(없는 계정도 한 번 돌린다)
//      → ④ 그 뒤에야 "끈 계정·잠긴 계정" 같은 진짜 이유를 알려준다.
//    ④를 앞으로 옮기면, 아무 비밀번호나 넣어 본 사람이 응답 문구만으로 **그 이메일이 실재하는지**
//    알아낼 수 있다(계정 목록 수집 → 표적 공격). auth.ts 검수 M-17이 그 사고였다.
//
// 🔴 운영자에게는 **비밀번호 찾기·재설정 창구가 없다.** 일부러 만들지 않았다 —
//    회원사 전체를 보는 계정의 재설정 통로는 그 자체가 가장 좋은 공격 표적이다.
//    잊었으면 다른 운영자 계정으로 들어가거나, 서버에서 scripts/create-operator.mjs 로 새로 만든다.
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createOperatorSession, destroyOperatorSession, getCurrentOperator } from "@/lib/operator-session";
import { recordOperatorFail, recordOperatorSuccess, operatorDoorAllows } from "@/lib/operator-policy";
import { lockRemainMinutes, EMAIL_MAX_LEN, PASSWORD_MAX_LEN, PASSWORD_INPUT_HARD_LIMIT } from "@/lib/login-policy";
// 🔴 고객사용 PASSWORD_MIN_LEN(10자)이 아니라 **운영자용 12자**를 쓴다(검수 치명 1).
//    전 회원사를 보는 유일한 계정이고 재설정 창구가 없어 정책이 더 엄하다.
import { OPERATOR_PASSWORD_MIN_LEN } from "@/lib/password-policy";
import { passwordAttemptAllowed } from "@/lib/password-attempt-limit";
import { checkPasswordStrength } from "@/lib/password-strength";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { loginAllowedForIp, recordThrottleHit, THROTTLED_META } from "@/lib/login-throttle";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

// 존재하지 않는 이메일에도 해시 비교를 한 번 돌리기 위한 더미 값(auth.ts와 같은 이유·같은 방식).
//  · 없는 계정이면 즉시 반환하면 **응답 시간만으로 계정 존재를 알 수 있다**(있으면 느리고 없으면 빠름).
//  · C-1로 해시가 비동기가 되어 파일 맨 위에서는 만들 수 없다 → **처음 필요할 때 한 번** 만들어 재사용한다.
//    (계산은 서버 수명 동안 여전히 1회. 약속을 담아 두므로 동시 요청에도 여러 번 돌지 않는다)
//  · ⚠️ 실패하면 담아 둔 것을 비운다 — 안 비우면 실패한 약속이 영원히 남아 **없는 계정일 때만 오류**가 나고,
//    그 차이로 계정 존재를 알아낼 수 있다(auth.ts와 같은 이유, 검수 2026-08-30 중간 2).
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("no-such-operator-placeholder").catch((e) => {
      dummyHashPromise = null;
      throw e;
    });
  }
  return dummyHashPromise;
}

/**
 * 접속기록 한 줄 남기기 — 운영자 이벤트 전용 모양.
 *
 * 🔴 `companyId`는 **반드시 null**이다. 이게 고객사와의 칸막이다 —
 *    고객사의 [보안]-[접속기록]·[이상접속] 화면은 전부 `where: { companyId: me.companyId }`로
 *    조회하므로, null인 기록은 어느 고객사에도 보이지 않는다(확인: app/security/access/page.tsx,
 *    lib/anomaly.ts). 여기에 회사 id를 넣으면 우리 운영 기록이 그 고객사 화면에 새어 나간다.
 *
 * 🔴 `userId`도 **null로 둔다.** 그 칸은 저장소 전체에서 `User.id`를 뜻한다. 운영자 id를 넣으면
 *    접속기록 화면이 사번을 붙이려고 User 표를 조회할 때(access/page.tsx) 엉뚱한 조회가 된다.
 *    운영자는 `actorName`과 `meta`로만 식별한다.
 */
async function logOperator(e: {
  // "config" = 운영자가 자기 계정을 바꿨다(비밀번호·이름). 2026-11-20 [내 계정] 화면과 함께 추가.
  kind: "login" | "login_fail" | "logout" | "config";
  result: "success" | "fail";
  name?: string | null;
  emailTried?: string | null;
  meta: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  await recordAccess({
    companyId: null,
    userId: null,
    actorName: e.name ? `운영자 ${e.name}` : "운영자",
    emailTried: e.emailTried ?? null,
    kind: e.kind,
    result: e.result,
    ip: e.ip,
    userAgent: e.userAgent,
    meta: e.meta,
  });
}

/** 운영자 로그인 — 성공하면 회원사 목록(/operator)으로 보낸다. */
export async function operatorLogin(
  _prev: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "이메일과 비밀번호를 입력해주세요." };
  }
  // 길이 상한 — 없으면 ①본문 크기만큼 긴 문자열이 접속기록에 2년 보관되고 ②그 값으로도 scrypt가
  // 돌아 서버가 멈춘다(scrypt는 동기 연산이라 그 사이 다른 요청도 함께 멈춘다).
  // ⚠️ 숫자는 고객사와 같은 상수를 쓴다(lib/login-policy.ts) — 창구마다 다르면 정책이 갈린다.
  if (email.length > EMAIL_MAX_LEN || password.length > PASSWORD_MAX_LEN) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  const { ip, userAgent } = readClientMeta(await headers());

  // 🔴 [검수 M-3] 이 문 전체의 초당 상한 — **DB에 닿기도 전에** 끊는다.
  //    아래 IP 단위 제한은 접속자 IP를 알아야 작동하고, IP는 프록시를 세운 뒤에만 읽힌다.
  //    그때까지 이 문은 인증 없이 scrypt(40ms 동안 서버 전체를 멈춤)를 돌릴 수 있는 창구가 되는데,
  //    운영자 한 문 때문에 **직원들이 출퇴근을 못 찍는 일**은 없어야 한다. 근거는 operator-policy.ts.
  //    ⚠️ 여기 걸린 요청은 DB 기록도 남기지 않는다 — 기록 자체가 폭주의 통로가 되기 때문이다.
  //       대신 서버 로그에 한 줄 남긴다(사람이 보고 프록시 제한을 걸 근거).
  if (!operatorDoorAllows()) {
    console.warn("[operator] 로그인 시도가 1분 상한을 넘어 거부했습니다(운영자 문 보호). IP:", ip ?? "미상");
    return { error: "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요." };
  }

  const op = await prisma.operator.findUnique({ where: { email } });

  // IP 단위 시도 제한 — 고객사 로그인과 **같은 기록(AccessEvent)·같은 임계치**를 쓴다.
  //  · 두 번째 인자는 "사내망 면제에 쓸 회사"인데 운영자는 소속 회사가 없으므로 null이다
  //    = 면제 없음. 전체를 보는 계정에는 예외를 두지 않는 것이 맞다.
  //  ⚠️ 판정만 먼저 하고 **차단은 비밀번호를 확인한 뒤에** 한다(auth.ts 검수 치명 1과 같은 이유) —
  //     비밀번호가 맞은 사람은 어떤 경우에도 막지 않는다.
  const ipThrottled = !(await loginAllowedForIp(ip, null));

  // 제한에 걸렸는데 **없는 계정**이면 해시를 돌리지 않고 바로 거부한다(auth.ts 검수 치명 2) —
  // scrypt 1회는 약 40ms 동안 서버 전체를 멈추므로, 이미 제한 중인 IP에까지 그 값을 태우면
  // 제한이 CPU를 한 푼도 아껴주지 못한다(그 자체가 서비스 마비 통로).
  if (ipThrottled && !op) {
    // actorName "운영자" — 없는 이메일이어도 운영자 문에서 난 시도임을 남긴다(/operator/access가 이 이름으로 모은다, 3단계 검수 경미 8)
    await recordThrottleHit({ ip, kind: "login_fail", meta: THROTTLED_META, actorName: "운영자", emailTried: email, userAgent });
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // ⚠️ `await`를 빼면 약속(Promise)이 담겨 아래 `!passwordOk`가 **항상 거짓**이 된다 = 아무 비밀번호나 통과.
  const passwordOk = op
    ? await verifyPassword(password, op.passwordHash)
    : (await verifyPassword(password, await dummyHash()), false);

  if (!op || !passwordOk) {
    // 실패 시: 실제 계정이면 실패 횟수를 올리고, 5회 도달하면 10분 잠근다(판정은 DB가 한다).
    if (op) await recordOperatorFail(prisma, op);
    if (ipThrottled) {
      // 제한에 걸린 시도는 1분에 1건만 남긴다 — 무제한 적재로 진짜 기록을 밀어내지 않게.
      //  ⚠️ actorName을 함께 넘긴다(검수 E-1). 안 넘기면 **정작 공격이 진행되는 순간의 기록에서
      //     표적 계정이 비어** 나중에 "누구를 두드렸는지"를 알 수 없다(auth.ts도 넘긴다).
      await recordThrottleHit({ ip, kind: "login_fail", meta: THROTTLED_META, actorName: op ? `운영자 ${op.name}` : "운영자", emailTried: email, userAgent });
    } else {
      await logOperator({ kind: "login_fail", result: "fail", name: op?.name ?? null, emailTried: email, meta: "operator_bad_credentials", ip, userAgent });
    }
    // 이메일·비밀번호 중 무엇이 틀렸는지 구분해 알려주지 않는다.
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // ── 여기부터는 **비밀번호가 맞은 사람**이다. 이제야 진짜 이유를 알려줘도 정보가 새지 않는다. ──

  // 끈 계정(퇴사·권한 회수)은 로그인 불가.
  if (!op.active) {
    await logOperator({ kind: "login_fail", result: "fail", name: op.name, emailTried: email, meta: "operator_inactive", ip, userAgent });
    return { error: "이 운영자 계정은 사용 중지되었습니다." };
  }

  // 연속 실패로 잠겨 있으면 비밀번호가 맞아도 잠금 해제 시각까지 거부한다.
  //  · 남은 시간 계산도 고객사와 같은 함수를 쓴다 — 창구마다 "약 N분"이 다르게 나오지 않게.
  const lockMins = lockRemainMinutes(op.lockedUntil);
  if (lockMins !== null) {
    await logOperator({ kind: "login_fail", result: "fail", name: op.name, emailTried: email, meta: "operator_locked", ip, userAgent });
    return { error: `비밀번호를 여러 번 잘못 입력했습니다. 약 ${lockMins}분 뒤에 다시 시도해주세요.` };
  }

  // 성공: 실패 기록 초기화 + 마지막 로그인 시각 기록.
  await recordOperatorSuccess(prisma, op.id);
  await createOperatorSession(op.id);
  await logOperator({ kind: "login", result: "success", name: op.name, emailTried: email, meta: "operator_login", ip, userAgent });

  // ⚠️ redirect는 내부적으로 예외를 던진다 — try/catch 안에 넣지 말 것(위 코드에 try가 없는 이유).
  redirect("/operator");
}

// ═══════════════════════════════════════════════════════════════════════════
// [내 계정] — 로그인한 운영자가 **자기** 비밀번호·이름을 바꾼다. (2026-11-20 사장님 요청)
//
// 🔴 **여기서 할 수 있는 것은 "내 것 바꾸기"뿐이다.** 새 계정 만들기·남의 계정 건드리기·
//    계정 끄기는 **절대 화면에 열지 않는다.** 그건 여전히 서버에서 scripts/create-operator.mjs 로만
//    한다. 이 파일 머리말과 그 스크립트가 못박은 이유 그대로다 — 회원사 전체를 보는 계정을
//    "만들 수 있는 통로"가 웹에 있으면 그 통로 자체가 가장 좋은 공격 표적이 된다.
//
// 🟢 그럼 왜 비밀번호 변경은 열었나: 지금은 바꾸려면 서버에서 명령을 쳐야 하는데,
//    **비밀번호가 PowerShell 명령 기록에 그대로 남는다**(create-operator.mjs 머리말의 경고).
//    로그인한 본인이 화면에서 바꾸는 쪽이 오히려 안전하다. 방어선(계정 생성)은 그대로 둔다.
//
// 방어 순서는 고객사 [계정 설정]의 changePassword(app/actions/account.ts)를 그대로 따른다:
//   ① 길이 상한(현재/새 값 상한이 다른 이유까지 그쪽 주석 참고)
//   ② 분당 시도 상한 — **대조(scrypt) 앞**에 둬야 CPU를 아낀다
//   ③ 현재 비밀번호 대조 → ④ 바꾸기 → ⑤ 다른 기기 세션 전부 끊기 → ⑥ 이 기기만 재발급
//
// 🔴 **잠금은 걸지 않는다.** 운영자에게는 5회 10분 잠금이 살아 있지만(lib/operator-policy.ts),
//    그건 로그인 문 이야기다. 이 창구에서까지 실패를 세어 잠그면 **본인이 자기 계정을 잠그고**,
//    운영자에게는 재설정 창구가 없어 서버 명령 없이는 못 푼다. 고객사 쪽도 같은 이유로
//    잠금 확인을 뺐다(account.ts 검수 H-1). 대신 ②의 분당 상한이 무제한 찍기를 막는다.
// ═══════════════════════════════════════════════════════════════════════════

// 분당 상한을 셀 때 쓰는 키. 고객사 User.id 와 섞이지 않게 접두사를 붙인다.
//  ⚠️ 비밀번호와 이름은 **서로 다른 키**여야 한다 — 같으면 이름을 몇 번 바꾸다가 비밀번호 변경이
//     막힌다(그 반대도 마찬가지). 두 함수를 나란히 둬서 한쪽만 바뀌는 일이 없게 한다.
function opAttemptKey(operatorId: string): string {
  return `operator:${operatorId}`;
}
function opNameAttemptKey(operatorId: string): string {
  return `operator-name:${operatorId}`;
}

/** 운영자 본인 비밀번호 변경. */
export async function changeOperatorPassword(
  _prev: { error?: string; ok?: boolean; relogin?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean; relogin?: boolean }> {
  const me = await getCurrentOperator();
  if (!me) return { error: "로그인이 필요합니다." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!current || !next || !confirm) return { error: "모든 항목을 입력해주세요." };

  // ① 길이 상한. 현재 비밀번호는 넉넉히 받는다(옛 긴 비밀번호를 쓰는 사람이 스스로 고칠 길을 막지 않기 위해).
  if (current.length > PASSWORD_INPUT_HARD_LIMIT) return { error: "현재 비밀번호가 올바르지 않습니다." };
  if (next.length > PASSWORD_MAX_LEN) return { error: `새 비밀번호는 ${PASSWORD_MAX_LEN}자 이하로 입력해주세요.` };
  if (next.length < OPERATOR_PASSWORD_MIN_LEN) {
    return { error: `새 비밀번호는 ${OPERATOR_PASSWORD_MIN_LEN}자 이상이어야 합니다.` };
  }
  {
    // 강도 검사 — 이메일·이름을 넘겨 "자기 정보가 섞인 비밀번호"를 걸러낸다.
    const weak = checkPasswordStrength(next, { email: me.email, name: me.name });
    if (weak) return { error: weak };
  }
  if (next !== confirm) return { error: "새 비밀번호 확인이 일치하지 않습니다." };

  // ② 분당 상한 — 반드시 대조 앞에서 한 번만 부른다(부르는 순간 1건으로 센다).
  if (!passwordAttemptAllowed(opAttemptKey(me.id))) {
    return { error: "비밀번호 확인을 너무 자주 시도했습니다. 1분 뒤에 다시 시도해주세요." };
  }

  // 해시는 getCurrentOperator 가 돌려주지 않는다(일부러 — lib/operator-session.ts 주석). 여기서만 따로 읽는다.
  const row = await prisma.operator.findUnique({ where: { id: me.id }, select: { passwordHash: true } });
  if (!row) return { error: "계정을 찾을 수 없습니다." };

  const { ip, userAgent } = readClientMeta(await headers());

  // ③ 현재 비밀번호 대조
  if (!(await verifyPassword(current, row.passwordHash))) {
    // 🔴 기록 종류를 login_fail 로 남긴다 — [운영자 접속 기록] 화면과 감시가 세는 것이 그 종류다.
    //    config 로 남기면 비밀번호를 찍는 시도가 감시망에 한 번도 안 잡힌다(account.ts 재검수 M-3과 같은 이유).
    await logOperator({ kind: "login_fail", result: "fail", name: me.name, emailTried: me.email, meta: "operator_password_change_denied", ip, userAgent });
    return { error: "현재 비밀번호가 올바르지 않습니다." };
  }
  if (current === next) return { error: "새 비밀번호가 현재 비밀번호와 같습니다." };

  // ④⑤ 바꾸기 + 다른 기기 세션 끊기를 **한 묶음(트랜잭션)**으로 한다(검수 중간 4).
  //    나눠 두면 "비밀번호는 바뀌었는데 세션은 안 끊긴" 상태가 생길 수 있고, 그러면 화면이 약속한
  //    "다른 기기에서 로그인한 상태가 모두 끊어집니다"가 **거짓**이 된다(훔쳐간 세션이 8시간 유효).
  //    비밀번호를 바꾸는 가장 큰 이유가 "누가 내 계정에 들어와 있는 것 같다"라서 그 약속이 핵심이다.
  //
  // 🔓 **이 창구는 잠금(lockedUntil)도 함께 푼다 — 의도한 동작이다**(검수 중간 3).
  //    lib/operator-policy.ts 는 "모든 쓰기에 '지금 잠겨 있지 않은 행' 조건을 걸라"고 하지만,
  //    그건 **로그인 문** 이야기다(비밀번호를 맞힌 요청이 잠금을 지우고 들어오는 것을 막는 규칙).
  //    여기는 **이미 로그인한 본인**이 현재 비밀번호까지 맞혀야 닿는 자리다. 운영자에게는 재설정
  //    창구가 없어, 로그인 문이 잠긴 동안 세션이 살아 있는 운영자가 **스스로를 구할 유일한 길**이
  //    이 창구다. 조건부 쓰기로 막으면 그 길까지 닫힌다.
  const newHash = await hashPassword(next);
  try {
    await prisma.$transaction([
      prisma.operator.update({
        where: { id: me.id },
        data: { passwordHash: newHash, failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.operatorSession.deleteMany({ where: { operatorId: me.id } }),
    ]);
  } catch (e) {
    // ⚠️ 오류 메시지를 통째로 찍지 않는다(사규 8). Prisma 검증 오류는 메시지에 **넘긴 인자를 펼쳐**
    //    넣어서 새 비밀번호 해시가 서버 콘솔에 남을 수 있다. 종류만 남긴다
    //    (lib/operator-session.ts 가 같은 이유로 못박아 둔 규칙).
    console.error("[operator] 비밀번호 변경 실패:", e instanceof Error ? e.name : "unknown");
    return { error: "비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해주세요." };
  }

  // ⚠️ 비밀번호 값은 절대 기록하지 않는다(사규 8). 바뀌었다는 사실만.
  await logOperator({ kind: "config", result: "success", name: me.name, emailTried: me.email, meta: "operator_password_change", ip, userAgent });

  // ⑥ 이 기기만 다시 로그인 상태로. 실패해도 **비밀번호는 이미 바뀌었다.**
  //    🔴 이때 `error`로 돌려주면 화면에 **빨간 실패 글씨**로 보여, 비개발자는 "실패했구나,
  //       옛 비밀번호로 다시 해보자"로 읽는다(검수 중간 5). 성공으로 알리고 재로그인만 안내한다.
  try {
    await createOperatorSession(me.id);
  } catch (e) {
    console.error("[operator] 비밀번호 변경 후 세션 재발급 실패:", e instanceof Error ? e.message : String(e));
    return { ok: true, relogin: true };
  }

  revalidatePath("/operator/account");
  return { ok: true };
}

/**
 * 화면·접속기록에 그대로 찍히는 이름을 안전한 모양으로 다듬는다(검수 중간 2).
 *  · 제어문자(줄바꿈·탭)와 **보이지 않는 글자**(zero-width, 글자 방향을 뒤집는 U+202E 등)를 없앤다.
 *    남겨 두면 상단 바와 기록 표의 줄이 깨지거나, 눈에 안 보이는 글자로 다른 사람을 사칭할 수 있다.
 *  · 괄호·콜론도 없앤다 — 접속기록 meta 가 `이름(from:옛이름)` 꼴이라, 이름에 그 글자가 섞이면
 *    기록 화면의 해석기가 괄호 짝을 잘못 찾아 **엉뚱한 뜻("대상: …")으로 표시**된다.
 *  · 연속 공백은 한 칸으로.
 */
function cleanOperatorName(raw: string): string {
  return (
    raw
      // ① 탭·줄바꿈 같은 제어문자는 **공백으로** 바꾼다(그냥 지우면 "홍\t길\n동"이 "홍길동"으로
      //    붙어 입력한 뜻이 달라진다 — 자체 시험에서 잡은 자리다).
      .replace(/\p{Cc}/gu, " ")
      // ② 눈에 보이지 않는 글자는 **지운다**(공백으로 바꾸면 "박성(zero-width)헌"이 "박성 헌"이 된다).
      //    `\p{Cf}` 하나로 충분하다 — U+200B~200D·2060·FEFF와 글자 방향을 뒤집는 U+202A~202E(사칭에
      //    쓰인다)가 전부 이 분류에 들어간다(2026-11-20 직접 실행해 10자 모두 확인).
      //    🔴 **여기에 그 글자들을 리터럴로 적지 않는다.** 소스에 눈에 안 보이는 글자가 박히면
      //       git diff 로도 안 보이고, 나중에 "이상한 글자"로 보고 지우면 `[\p{Cf}-]` 가 되어
      //       **하이픈이 조용히 삭제**된다("김-민수" → "김민수"). 검수가 짚은 함정이다.
      .replace(/\p{Cf}/gu, "")
      // ③ 괄호·콜론 제거 — 접속기록 meta 가 `이름(이전 이름 ○○○)` 꼴이라 해석기가 짝을 잘못 찾는다.
      .replace(/[()[\]{}:]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** 운영자 본인 이름 변경(화면·접속기록에 보이는 이름). */
export async function changeOperatorName(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const me = await getCurrentOperator();
  if (!me) return { error: "로그인이 필요합니다." };

  const name = cleanOperatorName(String(formData.get("name") ?? ""));
  if (!name) return { error: "이름을 입력해주세요." };
  // 접속기록에 그대로 찍히는 값이라 길이를 제한한다(화면 깨짐·기록 오염 방지).
  if (name.length > 30) return { error: "이름은 30자 이하로 입력해주세요." };
  if (name === me.name) return { ok: true };

  // 🔴 분당 상한 — 없으면 **접속기록 적재 통로**가 된다(검수 중간 1).
  //    두 이름을 번갈아 보내면 호출 1건마다 쓰기 1회 + 기록 1행이 무제한으로 쌓여,
  //    ① 진짜 침해 흔적을 뒤 페이지로 밀어내고 ② SQLite 쓰기 락이 직원 출퇴근 기록과 경합한다.
  //    ⚠️ 비밀번호 쪽과 **다른 키**를 쓴다 — 같은 키면 이름을 바꾸다가 비밀번호 변경이 막힌다.
  if (!passwordAttemptAllowed(opNameAttemptKey(me.id))) {
    return { error: "이름을 너무 자주 바꿨습니다. 1분 뒤에 다시 시도해주세요." };
  }

  await prisma.operator.update({ where: { id: me.id }, data: { name } });

  const { ip, userAgent } = readClientMeta(await headers());
  // 바뀐 뒤 이름으로 남긴다(옛 이름은 meta 에 적어 추적할 수 있게).
  //  ⚠️ meta 모양을 바꾸면 lib/access-labels.ts 의 사전도 함께 고칠 것 — 안 그러면 기록 화면이 공란이 된다.
  await logOperator({ kind: "config", result: "success", name, emailTried: me.email, meta: `operator_name_change(이전 이름 ${me.name})`, ip, userAgent });

  revalidatePath("/operator/account");
  return { ok: true };
}

/** 운영자 로그아웃. */
export async function operatorLogout(): Promise<void> {
  // 누가 로그아웃했는지 남기려면 세션 파기 **전에** 조회한다.
  const me = await getCurrentOperator();
  if (me) {
    const { ip, userAgent } = readClientMeta(await headers());
    await logOperator({ kind: "logout", result: "success", name: me.name, emailTried: me.email, meta: "operator_logout", ip, userAgent });
  }
  await destroyOperatorSession();
  redirect("/operator/login");
}
