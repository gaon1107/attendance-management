"use server";
// 비밀번호 재설정 — 경로가 **두 가지**다. 둘 다 살아 있어야 한다.
//
// [A] 문자 인증코드(직원 스스로) — 관리자 없이 밤·주말에도 된다. 전화번호가 등록된 직원만 쓸 수 있다.
//     sendResetCode → verifyResetCode → completeResetWithCode (아래 3개)
// [B] 관리자 발급(기존) — 전화번호가 없거나 문자 발송이 꺼져 있을 때의 **유일한 길**이라 없애지 않는다.
//     requestPasswordReset(직원 접수) → issueTempPassword(관리자 발급)
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { PASSWORD_MAX_LEN, EMAIL_MAX_LEN } from "@/lib/login-policy";
import { generateTempPassword, TEMP_PASSWORD_TTL_MS } from "@/lib/temp-password";
import { getCurrentUser } from "@/lib/session";
import { canManageAccount } from "@/lib/owner-rules";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import {
  publicActionAllowedForIp, recordThrottleHit,
  RESET_MAX_PER_IP, RESET_WINDOW_MIN, RESET_CODE_MAX_PER_IP, RESET_CODE_WINDOW_MIN,
} from "@/lib/login-throttle";
import { issueResetCode, checkResetCode } from "@/lib/reset-code";
import { publicDoorAllows } from "@/lib/public-door";
import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";

// ① 직원이 비밀번호 재설정을 요청한다(로그인 화면에서). 이메일만 받는다.
// 보안: 이메일이 실제로 있는지 여부를 응답으로 알려주지 않는다(있든 없든 같은 메시지).
//       실제로 있는 계정에 대해서만 대기 요청을 만든다. 이미 대기 중이면 중복 생성하지 않는다.
export async function requestPasswordReset(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "이메일을 입력해주세요." };
  // 형식·길이 검증(검수 치명 3) — 없으면 아무 문자열이나 접속기록에 저장돼 2년 보관된다.
  //  응답은 성공과 같게 유지한다(존재 여부 비노출 원칙).
  if (email.length > EMAIL_MAX_LEN || !email.includes("@")) return { ok: true };

  // 🔴 [검수 M-19] 로그인 없이 누구나 부를 수 있는 창구다 — 같은 IP에서 쏟아지는 요청을 막는다.
  //    막지 않으면 관리자 [직원 관리] 화면이 대기 요청으로 가득 차 진짜 요청이 묻힌다.
  //    ⚠️ 거부해도 안내 문구는 성공과 **같다** — 이메일 존재 여부를 알려주지 않는다는 이 함수의 원칙을 지킨다.
  //    ⚠️ 차단된 요청은 **1분에 1건만** 기록한다(검수 치명 3 + 2차 중간 4) — 매번 기록하면
  //       "막혀도 계속 쓰는" 통로가 되어 그 자체로 DB를 채우는 공격이 되고, 아예 안 남기면
  //       남용이 있었는지 사후에 확인할 방법이 없다.
  const { ip, userAgent } = readClientMeta(await headers());
  if (!(await publicActionAllowedForIp(ip, "reset_request", RESET_MAX_PER_IP, RESET_WINDOW_MIN))) {
    // 거부 사실은 **1분에 1건만** 남긴다 — 안 남기면 남용이 있었는지 사후에 알 방법이 없고(이 제품은
    // 콘솔 로그가 창을 닫으면 사라진다), 매번 남기면 그 자체가 DB를 채우는 통로가 된다(검수 2차 중간 4).
    await recordThrottleHit({ ip, kind: "public_request", meta: "reset_request_blocked", emailTried: email, userAgent });
    return { ok: true };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // 시도 기록 — 위 제한의 근거이자 남용 감지 자료.
  //  · IP를 모르면(TRUST_PROXY 미설정) 제한에 쓸 수 없으므로 기록하지 않는다 — 쓰기만 늘리지 않기 위함.
  //  · 회사를 알 수 있으면 함께 남긴다(그래야 [보안]-[접속기록] 화면에 보인다 — 검수 중간 4).
  if (ip) {
    await recordAccess({
      companyId: user?.companyId ?? null, userId: null, emailTried: email.slice(0, 254),
      kind: "public_request", result: "success", ip, userAgent, meta: "reset_request",
    });
  }

  // 실제 계정이고, 퇴사(비활성화)된 계정이 아닐 때만 요청을 만든다.
  //  · 🔒 회사 계정은 제외한다: 이 요청은 **관리자가 승인해 임시 비번을 발급**하는 구조라,
  //    회사 계정 요청을 만들어 두면 관리자가 직원 요청인 줄 알고 승인해 **회사 열쇠를 넘겨줄 수 있다**
  //    (검수 치명 1). 회사 계정 비밀번호는 회사 계정으로 직접 로그인해서만 바꾼다.
  //  · 응답은 있든 없든 동일하므로 "회사 계정이라 거부됐다"는 사실도 밖으로 새지 않는다.
  if (user && !user.deactivatedAt && !user.isOwner) {
    const existing = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.id, status: "pending" },
    });
    if (!existing) {
      await prisma.passwordResetRequest.create({
        data: { companyId: user.companyId, userId: user.id },
      });
    }
  }

  // 성공 여부와 무관하게 항상 같은 안내(이메일 존재 여부 노출 방지).
  return { ok: true };
}

// ② 관리자가 대기 요청을 처리 — 임시 비밀번호를 생성해 그 직원 계정에 적용한다.
//    반환값의 tempPassword를 관리자가 직원에게 전달한다. 직원은 이 임시비번으로 로그인하면
//    곧바로 "새 비밀번호 설정" 화면으로 강제 이동한다(mustChangePassword).
export async function issueTempPassword(
  requestId: string
): Promise<{ error?: string; ok?: boolean; tempPassword?: string; name?: string }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { error: "권한이 없습니다." };

  // 회사 격리: 내 회사의 대기 요청만 처리할 수 있다.
  const req = await prisma.passwordResetRequest.findFirst({
    where: { id: requestId, companyId: me.companyId, status: "pending" },
    include: { user: true },
  });
  if (!req) return { error: "이미 처리되었거나 없는 요청입니다." };
  if (req.user.deactivatedAt) return { error: "퇴사한 직원의 요청입니다." };
  // 🔒 회사 계정에는 임시 비번을 발급하지 않는다(회사 열쇠 탈취 경로 — 검수 치명 1).
  //    위 requestPasswordReset이 이미 막지만, 옛 요청이 남아 있을 수 있어 여기서도 검사한다.
  {
    const g = canManageAccount(me, req.user);
    if (!g.ok) return { error: g.reason };
  }

  const tempPassword = generateTempPassword();

  // 임시 비밀번호 적용 + "비번 변경 필요" 표시 + 실패/잠금 초기화. 기존 로그인 세션은 무효화.
  await prisma.user.update({
    where: { id: req.userId },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      // 임시 비밀번호는 48시간 안에만 쓸 수 있다(검수 H-4).
      //  문자로 전달되는 값이라 유출 위험이 있어 무기한으로 두면 안 된다.
      //  기한이 지나면 직원이 다시 재설정을 요청하면 된다.
      tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await prisma.session.deleteMany({ where: { userId: req.userId } });

  // 요청을 처리 완료로 표시.
  await prisma.passwordResetRequest.update({
    where: { id: req.id },
    data: { status: "resolved", resolvedAt: new Date() },
  });

  revalidatePath("/employees");
  revalidatePath("/dashboard");
  return { ok: true, tempPassword, name: req.user.name };
}

// ═══════════════════════════════════════════════════════════════════════════
// [A] 문자 인증코드 경로 — 직원이 관리자 없이 스스로 되찾는다.
//     규칙·제한값은 전부 lib/reset-code.ts에 있다. 여기는 창구(입력 검증·IP 제한·기록)만 담당한다.
// ═══════════════════════════════════════════════════════════════════════════

type CodeState = { error?: string; ok?: boolean };

// 🔴 인증번호 관련 실패는 **무슨 이유든 이 문구 하나**로만 답한다.
//    "틀렸다" 와 "없다/만료됐다" 를 구분해 주면, 이메일만 바꿔 던져서 재직 직원 명부를
//    통째로 열거할 수 있다(검수 치명 1). 사용자가 할 일은 어느 쪽이든 "다시 받기"로 같다.
const CODE_FAIL_MSG = "인증번호가 올바르지 않거나 만료되었습니다. 인증번호를 다시 받아 주세요.";

// 🔴 [검수 C-1] 문 전체가 분당 상한에 걸렸을 때의 문구.
//    CODE_FAIL_MSG를 쓰지 않는 이유: "인증번호가 틀렸다"고 하면 멀쩡한 코드를 가진 사람이
//    코드를 버리고 다시 받으러 간다 — 몰려 있는 상황을 더 악화시킨다.
//    정보가 새지도 않는다. 이 판정은 **어느 계정이냐와 무관한 서버 전체 상태**라,
//    누구에게나 같은 시점에 같은 답이 나간다.
const DOOR_BUSY_MSG = "지금 비밀번호 재설정 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.";

// A-① 이메일 + 전화번호 뒷 4자리 → 문자로 6자리 코드 발송.
//  ⚠️ **여기서 비밀번호를 바꾸지 않는다.** 바꿔 버리면 남의 이메일과 뒷번호만 알면 그 직원 로그인을
//     막을 수 있다(근태 제품에서 로그인 불가 = 근로기록 누락). 비밀번호는 A-③에서만 바뀐다.
//  ⚠️ 계정 없음·전화번호 불일치·한도 초과·발송 실패가 **전부 같은 응답**이다. 하나라도 구분해 주면
//     0000~9999를 훑어 전화번호 뒷 4자리를 확정할 수 있는 판별기가 된다(검수 치명 2).
export async function sendResetCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phoneTail = String(formData.get("phoneTail") ?? "").trim();

  // 입력 형식 오류는 알려준다 — 계정이 있든 없든 똑같이 나오는 판정이라 새어나갈 정보가 없다.
  // (조용히 성공 처리하면 오타 낸 사람이 오지 않을 문자를 5분간 기다린다 — 검수 중간 8)
  if (!email || !phoneTail) return { error: "이메일과 전화번호 뒷 4자리를 모두 입력해주세요." };
  if (email.length > EMAIL_MAX_LEN || !email.includes("@")) return { error: "이메일 형식이 올바르지 않습니다." };
  if (!/^\d{4}$/.test(phoneTail)) return { error: "전화번호 뒷 4자리를 숫자로 입력해주세요." };

  // 🔴 [검수 C-1] 재설정 3개 창구가 **함께 쓰는** 분당 상한(창구가 셋이라고 한도가 3배가 되면 안 된다).
  //    이 창구의 비용은 뒤로 미뤄지지만(after) 사라지지 않는다 — issueResetCode가 인증번호를
  //    scrypt로 해시하므로 요청 1건마다 서버가 40ms 멈춘다. 아래 IP 제한은 TRUST_PROXY 미설정 시
  //    무동작이므로, **DB에 닿기 전에** 여기서 끊는다.
  if (!publicDoorAllows("reset")) return { error: DOOR_BUSY_MSG };

  // 🔴 로그인 없이 누구나 부르는 창구다 — 기존 재설정 요청과 **같은 IP 예산**을 쓴다(창구가 둘이라고
  //    한도가 두 배가 되면 안 된다). ⚠️ TRUST_PROXY 미설정이면 이 제한은 무동작 →
  //    실질 방어선은 lib/reset-code.ts의 계정 단위 제한(1분 1건·하루 5건, DB 유니크로 강제)이다.
  const { ip, userAgent } = readClientMeta(await headers());
  if (!(await publicActionAllowedForIp(ip, "reset_request", RESET_MAX_PER_IP, RESET_WINDOW_MIN))) {
    await recordThrottleHit({ ip, kind: "public_request", meta: "reset_code_blocked", emailTried: email, userAgent });
    return { ok: true }; // 거부해도 성공과 같은 화면
  }

  // 시도 기록 — IP 제한의 근거(기존 경로와 같은 meta라 한 예산으로 센다).
  //  ※ 회사를 붙인 기록은 계정이 실재할 때 issueResetCode 안에서 따로 남긴다(meta: reset_code_sent).
  if (ip) {
    await recordAccess({
      companyId: null, userId: null, emailTried: email.slice(0, 254),
      kind: "public_request", result: "success", ip, userAgent, meta: "reset_request",
    });
  }

  // 🔴 **응답을 보낸 뒤에** 발급·발송한다(after) — 결과뿐 아니라 **응답 시간까지** 같아야 하기 때문이다.
  //    문구만 통일하고 await로 문자 API를 물고 있으면, 뒷자리가 맞았을 때만 수백ms~10초가 걸린다.
  //    0000~9999를 돌리며 **응답 시간만 재도** 뒷 4자리가 확정된다(검수 치명 B — 눈에 보이는 차이다).
  //    after()로 빼면 계정이 있든 없든 이 액션은 같은 일만 하고 끝난다.
  //    ※ 같은 패턴을 actions/attendance.ts·face.ts가 이미 쓴다.
  try {
    after(() => issueResetCode(email, phoneTail, { ip, userAgent }));
  } catch (e) {
    // after() 호출 자체가 실패해도 응답은 성공과 같아야 한다.
    console.error("[password-reset] 인증번호 발급 예약 실패:", e);
  }
  return { ok: true };
}

// A-② 코드 확인만 한다(비밀번호는 건드리지 않는다). 화면을 3단계로 나누기 위한 중간 확인.
//     여기서 코드를 소모하지 않는다 — 실제 확정은 A-③이 한 번 더 확인하면서 소모한다.
export async function verifyResetCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  if (!email || !code) return { error: "인증번호를 입력해주세요." };
  if (email.length > EMAIL_MAX_LEN) return { error: CODE_FAIL_MSG };

  // 🔴 [검수 C-1] 재설정 3개 창구가 함께 쓰는 분당 상한. 아래 checkResetCode가 저장된 코드 해시와
  //    대조하느라 scrypt를 돌리므로(요청당 40ms 서버 정지), DB 조회보다 **앞에서** 끊는다.
  if (!publicDoorAllows("reset")) return { error: DOOR_BUSY_MSG };

  // 코드 1건당 5회 상한은 "코드 하나"를 지킨다. 이건 "문 앞"을 지킨다(검수 중간 7).
  //  · 세는 대상(reset_code_wrong)은 코드당 최대 5건만 생기므로 이 기록이 적재 통로가 되지 않는다.
  //  · ⚠️ TRUST_PROXY 미설정이면 무동작 — 실질 방어선은 여전히 코드당 5회 상한이다.
  const guard = await guardCodeAttempts(email);
  if (guard) return guard;

  const { ip, userAgent } = readClientMeta(await headers());
  const r = await checkResetCode(email, code, false, { ip, userAgent });
  return r.ok ? { ok: true } : { error: CODE_FAIL_MSG };
}

/** 인증번호 확인 창구의 IP 제한. 막혔으면 화면에 줄 응답을 돌려주고, 통과면 null. */
async function guardCodeAttempts(email: string): Promise<CodeState | null> {
  const { ip, userAgent } = readClientMeta(await headers());
  if (await publicActionAllowedForIp(ip, "reset_code_wrong", RESET_CODE_MAX_PER_IP, RESET_CODE_WINDOW_MIN)) return null;
  await recordThrottleHit({ ip, kind: "public_request", meta: "reset_code_verify_blocked", emailTried: email, userAgent });
  // 거부도 실패와 같은 문구다 — 여기서 다른 말을 하면 그 자체가 신호가 된다.
  return { error: CODE_FAIL_MSG };
}

// A-③ 코드를 한 번 더 확인하고 **이때 비로소** 새 비밀번호를 적용한다.
//     A-②를 건너뛰고 바로 불려도 안전하다(코드 검증이 여기 안에 다시 들어 있다).
export async function completeResetWithCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!email || !code || !next || !confirm) return { error: "모든 항목을 입력해주세요." };
  // 비밀번호 규칙은 기존 변경 화면(actions/account.ts)과 같게 맞춘다 — 창구마다 기준이 다르면 안 된다.
  if (next.length < 8) return { error: "새 비밀번호는 8자 이상이어야 합니다." };
  // 해시 계산 폭주 방지. ⚠️ 숫자를 여기 적어두지 않는다 — 창구마다 기준이 갈린 적이 있다(검수 N-2).
  if (next.length > PASSWORD_MAX_LEN) return { error: `새 비밀번호는 ${PASSWORD_MAX_LEN}자 이하로 입력해주세요.` };
  if (next !== confirm) return { error: "새 비밀번호 확인이 일치하지 않습니다." };
  if (email.length > EMAIL_MAX_LEN) return { error: CODE_FAIL_MSG };

  // 🔴 [검수 C-1] 재설정 3개 창구가 함께 쓰는 분당 상한.
  //    이 창구는 scrypt를 **두 번** 돌린다 — 코드 대조(checkResetCode) + 새 비밀번호 해시.
  //    셋 중 가장 비싼 문이라 반드시 앞에서 끊는다.
  if (!publicDoorAllows("reset")) return { error: DOOR_BUSY_MSG };

  const guard = await guardCodeAttempts(email);
  if (guard) return guard;

  // 코드 확인 + 소모(1회용)를 한 번에. 여기를 통과해야만 아래 비밀번호 변경이 일어난다.
  const { ip: attemptIp, userAgent: attemptUa } = readClientMeta(await headers());
  const r = await checkResetCode(email, code, true, { ip: attemptIp, userAgent: attemptUa });
  if (!r.ok) return { error: CODE_FAIL_MSG };

  // 🔒 세 가지를 **한 묶음(트랜잭션)으로** 처리한다(검수 중간 2).
  //    쪼개져 있으면 "비밀번호는 바뀌었는데 훔쳐간 세션은 살아 있는" 상태가 생길 수 있는데,
  //    그건 이 기능을 만든 이유 자체를 무너뜨린다. 하나라도 실패하면 전부 없던 일이 된다.
  //  · mustChangePassword/tempPasswordExpiresAt 해제 — 본인이 직접 정한 비밀번호라 강제 변경 대상이 아니다.
  //  · 실패 횟수·잠금 해제 — 비번을 잊어 여러 번 틀린 상태로 오는 게 정상 경로다. 안 풀면 되찾고도 못 들어간다.
  //  · 관리자 대기 요청 종결 — 안 하면 관리자가 임시비번을 또 발급해 방금 정한 비밀번호가 무효가 된다.
  const user = await prisma.user.findUnique({ where: { id: r.userId }, select: { companyId: true, name: true } });
  const { ip, userAgent } = readClientMeta(await headers());
  // 해시는 **트랜잭션을 열기 전에** 만든다(C-1) — 안에서 기다리면 그 시간 내내 DB 쓰기 잠금을 쥔다.
  const nextHash = await hashPassword(next);

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: r.userId },
        data: {
          passwordHash: nextHash,
          mustChangePassword: false,
          tempPasswordExpiresAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      prisma.session.deleteMany({ where: { userId: r.userId } }),
      prisma.passwordResetRequest.updateMany({
        where: { userId: r.userId, status: "pending" },
        data: { status: "resolved", resolvedAt: new Date() },
      }),
    ]);
  } catch (e) {
    // 여기까지 왔다는 건 코드가 이미 소모됐다는 뜻이다(다시 못 쓴다). 사용자는 처음부터 다시 받아야 한다.
    // 🔴 이 실패를 기록으로 남긴다 — 안 남기면 "왜 안 바뀌었는지" 조사할 근거가 하나도 없다(검수 중간 8).
    console.error("[password-reset] 비밀번호 변경 트랜잭션 실패:", e);
    await recordAccess({
      companyId: user?.companyId ?? null, userId: r.userId, actorName: user?.name ?? null, emailTried: email,
      kind: "config", result: "fail", ip, userAgent, meta: "password_reset_by_sms_code",
    });
    return { error: "비밀번호를 바꾸는 중 문제가 생겼습니다. 인증번호를 다시 받아 주세요." };
  }

  // 감사기록 — 본인 것이지만 비밀번호 변경은 보안 사건이라 반드시 남긴다(값은 절대 미기록).
  await recordAccess({
    companyId: user?.companyId ?? null, userId: r.userId, actorName: user?.name ?? null, emailTried: email,
    kind: "config", result: "success", ip, userAgent, meta: "password_reset_by_sms_code",
  });

  revalidatePath("/employees");
  revalidatePath("/dashboard");
  return { ok: true };
}
