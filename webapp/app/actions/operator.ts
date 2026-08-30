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
import { lockRemainMinutes, EMAIL_MAX_LEN, PASSWORD_MAX_LEN } from "@/lib/login-policy";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { loginAllowedForIp, recordThrottleHit, THROTTLED_META } from "@/lib/login-throttle";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
  kind: "login" | "login_fail" | "logout";
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
    await recordThrottleHit({ ip, kind: "login_fail", meta: THROTTLED_META, emailTried: email, userAgent });
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
      await recordThrottleHit({ ip, kind: "login_fail", meta: THROTTLED_META, actorName: op ? `운영자 ${op.name}` : null, emailTried: email, userAgent });
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
