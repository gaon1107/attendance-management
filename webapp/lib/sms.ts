// 문자 발송 — 비즈모아샷(㈜신안정보통신). **학원관리와 같은 공용 모듈(@newgaon/moashot)**로 보낸다.
//  · 모듈 원본: newgaon-LMS/backend/lib/moashot (유일한 원본). 근태는 vendor/newgaon-moashot-<버전>.tgz로 설치한다.
//    학원관리 운영에서 실발송이 검증된 코드다(2026-10-02 "패스워드 오류" 수정, 10-30 연결 재시도 보완).
//  · 2026-11-21 사장님 결정: **인증 문자는 가온 계정 하나로** 보낸다(이 파일의 .env 계정).
//    회사 공지·초대·임시비번·카카오톡은 **각 회사가 모아샷에 가입한 계정**으로 보낼 예정이다(아직 없음 —
//    그래서 지금 일반 문자(purpose "general")는 actions/sms.ts에서 막혀 있다. lib/company-sms.ts 참고).
//  · 예전에 쓰던 아이원24 연동은 근태 운영에서 한 번도 켠 적이 없어 걷어냈다.
//  ※ 계정(아이디·비번·발신번호·발송주소)은 .env에서만 읽는다(하드코딩 금지). 하나라도 없으면 보내지 않는다.
import { sendSms as moashotSendSms } from "@newgaon/moashot";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/db";

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 [보안검수 M7] 문자 발송 상한 — 요금 폭탄 방지 + **한 회사가 다른 회사의 문자를 막지 못하게**.
//
// 왜 필요한가
//  · 문자는 건당 요금이다. 지금까지 상한은 전부 "한 사람·한 번호" 단위였다(인증번호 1분 1건·하루 5건 등).
//    그래서 여러 계정을 돌아가며 누르면 전체 발송량은 끝없이 늘어난다. 사장님 결정(2026-11-18): "문자 켤 때 이것 먼저".
//
// 🔴 세 겹이다 — 전체 상한 하나만 두면 생기는 사고(2026-11-21 검수 치명 C-1)
//    무료 가입한 회사 하나가 초대 문자를 1시간에 101번 보내면 **모든 고객사의 비밀번호 찾기 문자가 멈춘다.**
//    요금은 묶이지만 "다른 회사가 로그인할 수 있는가"를 공격자가 정하게 된다(근태 제품에서 로그인 불가 = 기록 누락).
//    ① 회사별 상한(COMPANY_*) — 한 회사가 쓸 수 있는 양. 모든 종류 합산.
//       회사 안에서도 일반 문자는 COMPANY_GENERAL_*까지만 — 초대 문자를 몰아 보내도 **그 회사 직원의 인증번호·
//       회사 계정 번호 변경이 막히지 않게** 보안 문자 몫을 남긴다(재검수 N-1: 회사 단위 몫이 없어 가입 첫날
//       초대 30통만으로 그 회사 비밀번호 찾기가 1시간 멈췄다).
//    ② 일반 문자 몫(GENERAL_*) — 초대·임시비번은 전체의 70%까지만. 나머지는 **보안 문자 몫으로 늘 남는다.**
//    ③ 전체 상한(GLOBAL_*) — 마지막 방어선. 보안 문자(인증번호·번호 확인·변경 통지)만 여기까지 쓸 수 있다.
//    ⚠️ 남는 위험: 가입 회사 여러 개를 만들어 가짜 직원으로 보안 문자를 쓰면 ③까지 닿을 수 있다.
//       그래도 회사마다 ①에 묶이고 요금은 ③에 묶인다. 더 막으려면 가입 자체의 남용 방지가 필요하다.
//
// 어떻게 세나
//  · 모든 발송 창구는 sendSms를 부르기 **전에** 발송기록(SmsLog)을 "보내는 중"으로 먼저 만든다.
//    그래서 발송 직전에 세면 **지금 보내려는 이 건까지** 포함된다 → "상한보다 많을 때"(>)만 막는다.
//    (발송 전에 미리 여유를 묻는 smsQuotaAllows는 아직 기록이 없으므로 "상한에 닿았을 때"(>=) 막는다.)
//  · **실제로 나갔거나 나가는 중인 건만** 센다(success · unknown · 10분 이내 pending).
//    ⚠️ 실패(fail)는 세지 않는다 — 상한에 막힌 건도 fail로 기록되므로, 세면 막힌 시도가 창을 계속 밀어
//       **공격이 끝나도 문자가 영영 안 나가는** 상태가 된다(2026-08-10에 같은 유형을 겪었다).
//  · 기록을 먼저 만들고 세므로 동시에 몰려도 넘치지 않는다(오히려 상한 근처에서 조금 일찍 막힐 수 있다).
//
// 값을 바꾸려면 아래 숫자만 고치면 된다(배포 필요).
// ═══════════════════════════════════════════════════════════════════════════
/** 모든 회사를 합쳐 1시간·24시간에 보낼 수 있는 최대 건수(보안 문자만 여기까지 쓸 수 있다). */
export const SMS_GLOBAL_MAX_PER_HOUR = 100;
export const SMS_GLOBAL_MAX_PER_DAY = 500;
/** 초대·임시비번 같은 일반 문자는 전체 발송량이 여기에 닿으면 멈춘다(나머지는 보안 문자 몫). */
export const SMS_GENERAL_MAX_PER_HOUR = 70;
export const SMS_GENERAL_MAX_PER_DAY = 350;
/** 회사 하나가 1시간·24시간에 보낼 수 있는 최대 건수(모든 종류 합산). */
export const SMS_COMPANY_MAX_PER_HOUR = 30;
export const SMS_COMPANY_MAX_PER_DAY = 100;
/** 회사 하나의 일반 문자(초대·임시비번)는 그 회사 발송량이 여기에 닿으면 멈춘다(나머지는 그 회사의 보안 문자 몫). */
export const SMS_COMPANY_GENERAL_MAX_PER_HOUR = 20;
export const SMS_COMPANY_GENERAL_MAX_PER_DAY = 70;
/** 이보다 오래된 "보내는 중"은 서버가 멈춘 흔적으로 보고 세지 않는다(발송 API는 10초 제한). */
const GLOBAL_PENDING_GRACE_MS = 10 * 60 * 1000;
/** 전체 상한에 걸렸을 때 문구. 회사·계정 정보가 없는 서버 전체 상태라 누구에게나 같다. */
export const SMS_GLOBAL_LIMIT_DETAIL = "문자 발송량이 일시적으로 많아 잠시 멈췄습니다. 잠시 후 다시 시도해주세요.";
/** 회사별 상한에 걸렸을 때 문구. ⚠️ 숫자를 적지 않는다 — 용도마다 한도가 달라 적힌 숫자가 거짓이 된다. */
export const SMS_COMPANY_LIMIT_DETAIL = "우리 회사의 문자 발송량이 많아 잠시 멈췄습니다. 잠시 후(최대 하루 뒤) 다시 시도해주세요.";

/** 상한 때문에 못 보낸 결과인가(화면에 그대로 보여줘도 되는 문구). */
export function isSmsLimitDetail(detail: string): boolean {
  return detail === SMS_GLOBAL_LIMIT_DETAIL || detail === SMS_COMPANY_LIMIT_DETAIL;
}

/**
 * 문자 용도. **보안 문자**(인증번호·번호 확인·연락처 변경 통지)는 전체 상한까지 쓸 수 있고,
 * **일반 문자**(초대·임시비번)는 일반 몫(70%)까지만 쓴다.
 */
export type SmsPurpose = "security" | "general";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 지난 windowMs 동안 실제로 나갔거나 나가는 중인 문자 건수. companyId를 주면 그 회사만. */
async function countRecentSends(now: Date, windowMs: number, companyId?: string): Promise<number> {
  return prisma.smsLog.count({
    where: {
      ...(companyId ? { companyId } : {}),
      createdAt: { gte: new Date(now.getTime() - windowMs) },
      OR: [
        { result: { in: ["success", "unknown"] } },
        { result: "pending", createdAt: { gte: new Date(now.getTime() - GLOBAL_PENDING_GRACE_MS) } },
      ],
    },
  });
}

/**
 * 상한 판정. 통과면 null, 막히면 화면용 문구.
 *  · `includesThis`: 지금 보내려는 건의 발송기록이 이미 세어지는가(sendSms 안 = true, 미리 묻기 = false).
 *  · DB를 못 읽으면 **보내지 않는다** — 셀 수 없는 문자는 요금 상한 밖이다.
 */
async function quotaBlock(companyId: string, purpose: SmsPurpose, now: Date, includesThis: boolean): Promise<string | null> {
  // includesThis=false면 "이걸 하나 더 보내면?"으로 센다.
  const extra = includesThis ? 0 : 1;
  try {
    const [cHour, cDay, gHour, gDay] = await Promise.all([
      countRecentSends(now, HOUR_MS, companyId),
      countRecentSends(now, DAY_MS, companyId),
      countRecentSends(now, HOUR_MS),
      countRecentSends(now, DAY_MS),
    ]);
    const cMaxHour = purpose === "security" ? SMS_COMPANY_MAX_PER_HOUR : SMS_COMPANY_GENERAL_MAX_PER_HOUR;
    const cMaxDay = purpose === "security" ? SMS_COMPANY_MAX_PER_DAY : SMS_COMPANY_GENERAL_MAX_PER_DAY;
    if (cHour + extra > cMaxHour || cDay + extra > cMaxDay) {
      console.error(`[sms] 회사별 발송 상한 도달(${purpose}) — 회사 ${companyId}: 1시간 ${cHour}/${cMaxHour}, 24시간 ${cDay}/${cMaxDay}. 이 회사 발송을 멈춘다.`);
      return SMS_COMPANY_LIMIT_DETAIL;
    }
    const maxHour = purpose === "security" ? SMS_GLOBAL_MAX_PER_HOUR : SMS_GENERAL_MAX_PER_HOUR;
    const maxDay = purpose === "security" ? SMS_GLOBAL_MAX_PER_DAY : SMS_GENERAL_MAX_PER_DAY;
    if (gHour + extra > maxHour || gDay + extra > maxDay) {
      // 운영자가 알아챌 수 있게 남긴다(수신번호·본문은 남기지 않는다).
      console.error(`[sms] 🔴 전체 발송 상한 도달(${purpose}) — 1시간 ${gHour}/${maxHour}, 24시간 ${gDay}/${maxDay}. 발송을 멈춘다.`);
      return SMS_GLOBAL_LIMIT_DETAIL;
    }
    return null;
  } catch (e) {
    console.error("[sms] 발송량 확인 실패 — 안전을 위해 발송하지 않는다:", e instanceof Error ? e.message : String(e));
    return SMS_GLOBAL_LIMIT_DETAIL;
  }
}

/**
 * **보내기 전에** 한 건 더 보낼 여유가 있는가.
 *  · 문자를 못 보내면 안 되는 동작이 먼저 물어본다 — 예: 회사 계정 복구 번호 변경은 옛 번호로 통지가
 *    나가야만 허용한다(탐지 장치가 꺼진 채 번호가 바뀌는 것을 막는다 — 검수 C-1 (c)).
 */
export async function smsQuotaAllows(companyId: string, purpose: SmsPurpose, now: Date = new Date()): Promise<boolean> {
  return (await quotaBlock(companyId, purpose, now, false)) === null;
}

// 전화번호에서 숫자만 남긴다 — **원본은 lib/phone.ts에 있다.** 기존 import 경로를 위해 다시 내보낸다.
export { normalizePhone } from "@/lib/phone";

// 가온 인증 문자 계정이 쓸 수 있는 상태인가(.env 4개가 모두 있는가).
//  · [비밀번호 찾기]가 이 값으로 화면을 가른다: 미설정이면 문자 인증코드 방식을 아예 보여주지 않고
//    기존 "관리자 승인" 방식으로 안내한다. 안 그러면 "코드를 보냈다"고 해놓고 영영 안 오는 화면이 된다.
//  · 계정 값 자체는 절대 밖으로 내보내지 않는다 — 있고 없음만 알린다.
export function smsConfigured(): boolean {
  return account() !== null;
}

// .env 계정. 하나라도 없으면 null(→ 발송 안 함, 안전 실패).
//  · 발송 주소도 필수다 — 모듈이 주소가 없으면 보내지 않는다(실서버 오발송 방지 설계). 운영 값은
//    https://biz.moashot.com/EXT/URLASP/mssendUTF.asp (= 모듈의 DEFAULT_SEND_URL).
//  · 주소는 **보낼 때마다** 읽는다 — 시험 때 가짜 수신처로 돌려도 서버를 재시작하지 않아도 된다.
//  · 🔴 [검수 중간 4] 값이 "있기만" 하면 켜진 것으로 보면 안 된다. 발송 주소가 http이거나 발신번호 모양이
//    틀리면 모듈이 보내기를 거부하는데, 화면은 문자 인증을 보여 주고 비밀번호 찾기는 일부러 아무 말도 안 하므로
//    직원은 영영 안 오는 문자를 기다린다. → 모듈이 거부할 값이면 **처음부터 꺼진 것으로** 본다.
function account(): { id: string; password: string; sender: string; sendUrl: string } | null {
  const id = process.env.MOASHOT_ID;
  const password = process.env.MOASHOT_PW;
  const sender = normalizePhone(process.env.MOASHOT_SENDER ?? "");
  const sendUrl = (process.env.MOASHOT_SEND_URL ?? "").trim();
  if (!id || !password || !sender || !sendUrl) return null;
  if (!/^[0-9]{8,12}$/.test(sender) || !isAllowedSendUrl(sendUrl)) {
    warnBadConfigOnce();
    return null;
  }
  return { id, password, sender, sendUrl };
}

/** 모듈(sms.js isSecureSendUrl)과 같은 규칙 — https만, 시험용 내 컴퓨터 주소만 http 허용. */
function isAllowedSendUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  } catch {
    return false;
  }
}

let badConfigWarned = false;
function warnBadConfigOnce(): void {
  if (badConfigWarned) return;
  badConfigWarned = true;
  // 값 자체는 남기지 않는다(비밀번호가 섞일 수 있다). 어느 칸을 볼지만 알린다.
  console.error("[sms] 🔴 문자 설정값이 잘못돼 문자를 끈 상태로 둔다 — MOASHOT_SEND_URL은 https, MOASHOT_SENDER는 숫자 8~12자리여야 한다.");
}

export type SmsResult = { ok: boolean; detail: string };

/** 발송 응답이 늦을 때 기다리는 최대 시간. 서버 동작이 매달리지 않게 한다. */
const SEND_TIMEOUT_MS = 10_000;

// 문자 1건 발송. 단문/장문은 모듈이 자동으로 가른다(EUC-KR 90바이트). 예외·미설정은 던지지 않고 결과로 반환한다.
//  · companyId·purpose는 **필수**다 — 빠뜨리면 회사별 상한·보안 문자 몫이 조용히 무력화된다(검수 C-1).
//  · ⚠️ ok는 비즈모아샷이 **접수**했다는 뜻이다(실제 도착 결과는 콜백으로 오는데, 근태는 아직 콜백을 받지 않는다).
//    화면 문구가 "보냈습니다/요청했습니다"까지만 말하는 이유다(도착을 보장하지 않는다).
export async function sendSms(opts: { to: string; text: string; subject?: string; companyId: string; purpose: SmsPurpose }): Promise<SmsResult> {
  const acc = account();
  if (!acc) return { ok: false, detail: "문자 발송계정이 설정되지 않았습니다(.env)." };

  const to = normalizePhone(opts.to);
  if (to.length < 9 || to.length > 12) return { ok: false, detail: "수신 전화번호가 올바르지 않습니다." };

  const text = opts.text ?? "";
  if (text.trim() === "") return { ok: false, detail: "보낼 내용이 없습니다." };

  // 🔴 [M7] 회사별·전체 상한 — 발송 API를 부르기 직전, 입력 검사가 끝난 뒤에 센다(형식 오류는 DB를 안 건드린다).
  {
    const blocked = await quotaBlock(opts.companyId, opts.purpose, new Date(), true);
    if (blocked) return { ok: false, detail: blocked };
  }

  try {
    const r = await moashotSendSms(
      {
        account: { id: acc.id, password: acc.password, sender: acc.sender },
        to,
        text,
        title: opts.subject ?? "근태관리 알림", // 장문일 때만 제목으로 붙는다
      },
      { sendUrl: acc.sendUrl, timeoutMs: SEND_TIMEOUT_MS }
    );
    if (r.ok) return { ok: true, detail: "접수 성공" };
    // 🔴 [검수 중간 3] 문자 회사가 답을 줬는데 실패면 모듈의 error에 **응답 원문**이 그대로 들어 있다
    //    (오류 HTML 페이지 등). 그대로 돌려주면 발송기록·화면에 원문이 쌓이므로 정해진 문구로 바꾸고,
    //    원문은 태그를 걷어 짧게 줄여 서버 로그에만 남긴다. 응답이 없는 실패(연결 오류·설정 거부)는
    //    모듈이 만든 한글 사유라 그대로 쓴다.
    if (r.raw) {
      console.error("[sms] 문자 회사가 접수를 거절:", r.raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120));
      return { ok: false, detail: "문자 회사가 접수를 거절했습니다." };
    }
    return { ok: false, detail: r.error ?? "문자 접수 실패" };
  } catch (e) {
    // 모듈은 예외를 결과로 바꿔 주지만, 혹시 모를 예외도 이 함수 밖으로 던지지 않는다(호출부 약속).
    return { ok: false, detail: e instanceof Error ? e.message : "문자 발송 중 오류가 발생했습니다." };
  }
}
