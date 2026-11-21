"use server";
// 회사별 비즈모아샷 문자 계정 — 저장 / 연결 해제 / 시험 문자 (2026-11-21, 메시지 관리 1단계).
//  · 화면: app/settings/CompanySmsForm.tsx ([설정 → 문자·알림톡] 탭). 읽기·상태: lib/company-sms-account.ts.
//  · 권한: **관리자 전원**(다른 [설정]과 같다 — 사장님 결정 2026-11-21). 회사 격리는 me.companyId로만 한다.
//  · 1단계는 "등록"만 한다. 직원 비밀번호 찾기·초대·임시비번 발송은 아직 이 계정으로 바뀌지 않는다(2단계).
//  🔒 비밀번호
//   · 암호문으로만 저장한다(lib/sms-crypto.ts). 서버에 키(SMS_CRED_KEY)가 없으면 **저장을 거부**한다(평문 저장 금지).
//   · 화면으로 다시 내보내지 않는다. 비워 두고 저장하면 기존 값을 유지한다.
//   · 접속기록(감사)에는 "바꿨다"는 사실만 남긴다. 아이디·비밀번호·번호 값은 남기지 않는다.
import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { encryptSmsPassword, hasSmsCryptoKey, decryptSmsPassword } from "@/lib/sms-crypto";
import { loadCompanySmsAccount } from "@/lib/company-sms-account";
import { sendCompanySms } from "@/lib/sms";
import { toLocalPhone, isMobilePhone, formatPhone } from "@/lib/phone";

export type CompanySmsFormState = { error?: string; ok?: boolean; message?: string };

/** 비즈모아샷 아이디 — 공백 없는 보이는 ASCII 1~50자. */
const SMS_ID_PATTERN = /^[\x21-\x7E]{1,50}$/;
/** 비밀번호 최대 길이(학원관리 sms_password 칸과 같은 한도). */
const SMS_PW_MAX = 100;
/** 시험 문자 — 하루(24시간) 실제로 나간(나갔을 수 있는) 최대 건수. 회사 요금이 나가는 버튼이라 묶는다. */
const TEST_MAX_PER_DAY = 5;
/**
 * 시험 문자 — 하루(24시간) **시도** 최대 횟수(실패 포함). (검수 M-2)
 *  · 실패를 안 세면 "저장 → 시험"을 1분마다 반복해 **남의 비즈모아샷 비밀번호를 하루 1,440번 맞춰 볼 수** 있다
 *    (응답이 "거절"인지 "접수"인지로 맞았는지 안다). 모든 시도가 우리 서버 IP에서 나가므로, 비즈모아샷이 IP를
 *    막으면 가온 계정 인증 문자까지 멈춘다.
 *  · 잘못 입력한 회사가 하루 잠길 수 있다는 단점은 있지만, 10번이면 정상 사용에는 충분하다.
 */
const TEST_MAX_ATTEMPTS_PER_DAY = 10;
/** 계정 저장 — 하루(24시간) 최대 횟수. 비밀번호를 바꿔 가며 맞춰 보는 것을 같이 묶는다(검수 M-2). */
const SAVE_MAX_PER_DAY = 20;
/** 발송기록 종류. 회사 계정 발송이라 기록에 viaCompany: true를 남긴다 — 그래야 가온 전체 상한에서 빠진다(lib/sms.ts). */
const TEST_KIND = "sms_test";
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * 시험 문자 본문 — **고정 문구**다. 회사명 같은 입력값을 넣지 않는다(다른 인증 문자들과 같은 규칙).
 *  · 🔴 **단문(EUC-KR 90바이트 이하)**이어야 한다. 넘으면 장문으로 나가 요금이 약 3배가 되고 화면의 "문자 요금 1건"이
 *    거짓이 된다(검수 M-1 — 예전 문구는 92바이트였다). 지금 문구 55바이트. 바꾸면 모듈 getEuckrByteLength로 다시 잴 것.
 */
const TEST_TEXT = "[근태관리] 문자 연결 시험입니다. 받으셨다면 정상입니다.";

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return null;
  return me;
}

// ① 저장 — 아이디·발신번호·(바꿀 때만) 비밀번호.
export async function saveCompanySmsAccount(_prev: CompanySmsFormState, formData: FormData): Promise<CompanySmsFormState> {
  const me = await requireAdmin();
  if (!me) return { error: "권한이 없습니다." };

  const smsId = String(formData.get("smsId") ?? "").trim();
  // 비밀번호는 다듬지 않는다(앞뒤 공백도 비밀번호일 수 있다). 비어 있으면 "유지".
  const password = String(formData.get("password") ?? "");
  // 국제 표기(+82 …)도 국내 번호로 바꿔 저장한다(검수 M-4 — 바꾸지 않으면 그대로 발송돼 거절·오발송).
  const sender = toLocalPhone(String(formData.get("sender") ?? ""));

  if (!SMS_ID_PATTERN.test(smsId)) return { error: "비즈모아샷 아이디를 확인해 주세요(공백 없이 50자 이내)." };
  if (password.length > SMS_PW_MAX) return { error: `비밀번호가 너무 깁니다(${SMS_PW_MAX}자 이내).` };
  // 제어문자(줄바꿈 등)는 비밀번호로 쓸 수 없다 — 붙여넣기 실수를 막는다.
  if (/[\x00-\x1F\x7F]/.test(password)) return { error: "비밀번호에 쓸 수 없는 글자(줄바꿈 등)가 들어 있습니다." };
  if (!/^[0-9]{8,12}$/.test(sender)) return { error: "발신번호를 숫자로 정확히 입력해 주세요(비즈모아샷에 사전등록한 번호)." };

  // 하루 저장 횟수 — 비밀번호를 바꿔 가며 맞춰 보는 것을 묶는다(검수 M-2). 성공한 저장만 기록되므로 그것을 센다.
  const savesToday = await prisma.accessEvent.count({
    where: { companyId: me.companyId, kind: "config", meta: "sms_account_save", createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  if (savesToday >= SAVE_MAX_PER_DAY) {
    return { error: `문자 계정은 하루 ${SAVE_MAX_PER_DAY}번까지 저장할 수 있습니다. 내일 다시 시도해 주세요.` };
  }

  const current = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { smsId: true, smsPasswordEnc: true },
  });
  const idChanged = (current?.smsId ?? null) !== smsId;

  // 비밀번호를 비워 두면 기존 값을 쓴다 — 단,
  //  · 아이디가 바뀌면 옛 비밀번호는 새 아이디의 것이 아니다.
  //  · 저장된 비밀번호를 지금 풀 수 없으면(서버 열쇠가 바뀜 등) 유지할 값이 없다 — "저장했습니다"라고 하면 거짓이다.
  if (password === "") {
    if (!current?.smsPasswordEnc) return { error: "비밀번호를 입력해 주세요." };
    if (idChanged) return { error: "아이디를 바꾸면 비밀번호도 다시 입력해 주세요." };
    if (decryptSmsPassword(current.smsPasswordEnc) === null) {
      return { error: "저장된 비밀번호를 쓸 수 없습니다. 비밀번호를 다시 입력해 주세요." };
    }
  }

  let passwordEnc: string | undefined;
  if (password !== "") {
    if (!hasSmsCryptoKey()) {
      console.error("[company-sms] SMS_CRED_KEY가 없어 회사 문자 계정을 저장하지 못했다 — 운영 .env 확인 필요.");
      return { error: "서버 설정(암호화 열쇠)이 아직 끝나지 않아 저장할 수 없습니다. 가온 고객지원에 문의해 주세요." };
    }
    passwordEnc = encryptSmsPassword(password);
  }

  // 🔒 조건부 갱신(1단계 검수 경미 2): 읽은 뒤 다른 관리자가 아이디를 바꿨으면 저장하지 않는다.
  //    안 막으면 "A가 새 아이디+새 비밀번호 저장" 사이에 "B가 옛 아이디+비밀번호 유지로 저장"이 끼어들어
  //    **옛 아이디 + 새 아이디의 비밀번호**라는 쓸 수 없는 조합이 남는다.
  const saved = await prisma.company.updateMany({
    where: { id: me.companyId, smsId: current?.smsId ?? null },
    data: {
      smsId,
      smsSender: sender,
      ...(passwordEnc ? { smsPasswordEnc: passwordEnc } : {}),
      smsAccountUpdatedAt: new Date(),
    },
  });
  if (saved.count === 0) {
    return { error: "방금 다른 관리자가 문자 계정을 바꿨습니다. 화면을 새로 고친 뒤 다시 저장해 주세요." };
  }

  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
    kind: "config", result: "success", ip, userAgent, meta: "sms_account_save",
  });

  revalidatePath("/settings");
  return { ok: true, message: "저장했습니다. [시험 문자 보내기]로 실제 연결을 확인해 보세요." };
}

// ② 연결 해제 — 아이디·비밀번호·발신번호를 지운다. (알림톡 채널 키는 4단계 몫이라 두지 않는다 — 1단계엔 입력 칸도 없다)
//    입력값이 없어 화면이 직접 부른다(확인 팝업의 [연결 해제] 버튼 → useTransition).
export async function clearCompanySmsAccount(): Promise<CompanySmsFormState> {
  const me = await requireAdmin();
  if (!me) return { error: "권한이 없습니다." };

  await prisma.company.update({
    where: { id: me.companyId },
    data: { smsId: null, smsPasswordEnc: null, smsSender: null, smsAccountUpdatedAt: new Date() },
  });

  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
    kind: "config", result: "success", ip, userAgent, meta: "sms_account_clear",
  });

  revalidatePath("/settings");
  return { ok: true, message: "연결을 해제했습니다. 저장돼 있던 아이디·비밀번호·발신번호를 지웠습니다." };
}

// ③ 시험 문자 — 저장한 계정으로 1통(그 회사 요금). 1분 1통·하루 5통.
export async function sendCompanySmsTest(_prev: CompanySmsFormState, formData: FormData): Promise<CompanySmsFormState> {
  const me = await requireAdmin();
  if (!me) return { error: "권한이 없습니다." };

  // 국제 표기(+82 …)는 국내 번호로 바꿔서 판정·발송한다(검수 M-4 — 판정만 바꾸고 발송은 원래 값으로 하면 어긋난다).
  const to = toLocalPhone(String(formData.get("to") ?? ""));
  if (!isMobilePhone(to)) return { error: "시험 문자를 받을 휴대폰 번호를 정확히 입력해 주세요." };

  // 계정을 먼저 확인한다 — 없으면 기록도 만들지 않는다(상한 칸을 쓸데없이 채우지 않게).
  if (!(await loadCompanySmsAccount(me.companyId))) {
    return { error: "먼저 계정을 저장해 주세요. 저장했는데도 이 안내가 나오면 비밀번호를 다시 입력해 저장해 주세요." };
  }

  const now = new Date();
  const since = new Date(now.getTime() - DAY_MS);
  // 하루 상한 두 겹:
  //  ① 시도 횟수(실패 포함) — 비밀번호 맞춰 보기 방지(검수 M-2).
  //  ② 실제로 나갔거나 나갔을 수 있는 건수 — 회사 요금.
  const [attemptsToday, sentToday] = await Promise.all([
    prisma.smsLog.count({ where: { companyId: me.companyId, kind: TEST_KIND, createdAt: { gte: since } } }),
    prisma.smsLog.count({
      where: { companyId: me.companyId, kind: TEST_KIND, createdAt: { gte: since }, result: { in: ["success", "unknown", "pending"] } },
    }),
  ]);
  if (attemptsToday >= TEST_MAX_ATTEMPTS_PER_DAY) {
    return { error: `시험 문자는 하루 ${TEST_MAX_ATTEMPTS_PER_DAY}번까지 시도할 수 있습니다. 아이디·비밀번호·발신번호를 비즈모아샷에서 다시 확인한 뒤 내일 시도해 주세요.` };
  }
  if (sentToday >= TEST_MAX_PER_DAY) return { error: `시험 문자는 하루 ${TEST_MAX_PER_DAY}통까지 보낼 수 있습니다.` };

  // 1분 1통 — 발송기록의 (회사·종류·refId) 유니크로 DB가 보장한다(동시에 여러 번 눌러도 하나만 통과).
  //  · 실패해도 refId를 풀지 않는다: 틀린 비밀번호로 1분에 수십 번 문자 회사를 두드리는 것을 막는다.
  //  · 기록을 **먼저** 만들어야 상한(lib/sms.ts quotaBlock)이 이 건까지 센다.
  let logId: string;
  try {
    const log = await prisma.smsLog.create({
      data: {
        companyId: me.companyId, userId: me.id, kind: TEST_KIND,
        refId: `m${Math.floor(now.getTime() / 60000)}`, toNumber: to, result: "pending", viaCompany: true,
      },
      select: { id: true },
    });
    logId = log.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "시험 문자는 1분에 한 번만 보낼 수 있습니다. 잠시 후 다시 눌러 주세요." };
    }
    throw e;
  }

  const res = await sendCompanySms({ to, text: TEST_TEXT, companyId: me.companyId, purpose: "general" });

  try {
    await prisma.smsLog.update({
      where: { id: logId },
      // 시간 초과·응답 도중 끊김은 실제로 접수·과금됐을 수 있다 → "결과 미확인(unknown)". 요금 상한에 계속 센다.
      data: res.ok
        ? { result: "success", detail: null }
        : { result: res.uncertain ? "unknown" : "fail", detail: res.detail.slice(0, 200) },
    });
  } catch (e) {
    console.error("[company-sms] 시험 문자 결과 기록 실패(기록은 '보내는 중'으로 남는다):", { logId }, e);
  }

  const { ip, userAgent } = readClientMeta(await headers());
  await recordAccess({
    companyId: me.companyId, userId: me.id, actorName: me.name, emailTried: me.email,
    kind: "config", result: res.ok ? "success" : "fail", ip, userAgent, meta: "sms_test_send",
  });

  if (!res.ok && res.uncertain) {
    return { error: "문자 회사의 응답이 늦어 결과를 확인하지 못했습니다. 1~2분 안에 문자가 오는지 확인해 주세요. 오지 않으면 잠시 후 다시 시도해 주세요." };
  }
  if (!res.ok) return { error: `보내지 못했습니다. ${res.detail}` };
  // ⚠️ ok = 문자 회사가 **접수**했다는 뜻이다(도착 보장 아님). 그래서 "접수됐다"까지만 말한다.
  return {
    ok: true,
    message: `접수됐습니다. 1~2분 안에 ${formatPhone(to)}로 문자가 오면 연결이 정상입니다. 오지 않으면 발신번호가 비즈모아샷에 사전등록됐는지, 잔액이 있는지 확인해 주세요.`,
  };
}
