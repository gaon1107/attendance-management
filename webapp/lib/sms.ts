// 아이원24(iOne24) 문자 발송 — 초대·임시비밀번호 발송용(부가 수단).
// 원본: newgaon-LMS/SMS_연동_이식_가이드.md (Java/GFKids)의 API 규격을 TypeScript로 재구현.
// 규격: POST form-urlencoded(본문 EUC-KR) / 응답 body 비어있으면 성공 / 90byte 이하=SMS·초과=LMS.
// ※ 계정(발신ID·비번·발신번호)은 .env에서만 읽는다(하드코딩 금지). 미설정이면 안전하게 실패 반환.
import iconv from "iconv-lite";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/db";

// 발송 주소는 **보낼 때마다** 읽는다(예전엔 파일을 처음 불러올 때 한 번 읽어 고정했다).
//  · 운영 동작은 같다. 시험할 때 가짜 수신처로 돌려도 서버를 재시작하지 않아도 되게 하려는 것이다.
function sendUrl(): string {
  return process.env.IONE_SMS_SEND_URL || "http://smsmsgr.ione24.com/slma_action_gaon.ashx";
}

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
/** 이보다 오래된 "보내는 중"은 서버가 멈춘 흔적으로 보고 세지 않는다(발송 API는 10초 제한). */
const GLOBAL_PENDING_GRACE_MS = 10 * 60 * 1000;
/** 전체 상한에 걸렸을 때 문구. 회사·계정 정보가 없는 서버 전체 상태라 누구에게나 같다. */
export const SMS_GLOBAL_LIMIT_DETAIL = "문자 발송량이 일시적으로 많아 잠시 멈췄습니다. 잠시 후 다시 시도해주세요.";
/** 회사별 상한에 걸렸을 때 문구. */
export const SMS_COMPANY_LIMIT_DETAIL = "우리 회사의 문자 발송량이 많아 잠시 멈췄습니다(1시간 30건·하루 100건). 잠시 후 다시 시도해주세요.";

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
    if (cHour + extra > SMS_COMPANY_MAX_PER_HOUR || cDay + extra > SMS_COMPANY_MAX_PER_DAY) {
      console.error(`[sms] 회사별 발송 상한 도달 — 회사 ${companyId}: 1시간 ${cHour}, 24시간 ${cDay}. 이 회사 발송을 멈춘다.`);
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

// EUC-KR 기준 바이트 길이(한글 2·ASCII 1). SMS/LMS 구분에 사용.
export function smsByteLength(text: string): number {
  return iconv.encode(text ?? "", "euc-kr").length;
}

// 90바이트 이하면 SMS(pslma=0), 초과면 LMS(pslma=1).
export function isSmsType(text: string): boolean {
  return smsByteLength(text) <= 90;
}

// 전화번호에서 숫자만 남긴다 — **원본은 lib/phone.ts에 있다**(이 파일은 iconv-lite를 쓰는 서버 전용이라,
// 화면 코드가 전화번호 도우미 때문에 이 파일을 부르지 않게 하려고 옮겼다). 기존 import 경로는 유지된다.
export { normalizePhone } from "@/lib/phone";

// EUC-KR form-urlencoded 값 인코딩: 값을 EUC-KR 바이트로 만든 뒤 퍼센트 인코딩(영숫자만 그대로, 공백은 +).
function percentEncodeEucKr(value: string): string {
  const bytes = iconv.encode(value ?? "", "euc-kr");
  let out = "";
  for (const b of bytes) {
    if ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) {
      out += String.fromCharCode(b); // 0-9 A-Z a-z
    } else if (b === 0x20) {
      out += "+"; // 공백
    } else {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

function eucKrFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${percentEncodeEucKr(v ?? "")}`)
    .join("&");
}

// 문자 발송이 쓸 수 있는 상태인가(.env 계정 3개가 모두 있는가).
//  · [비밀번호 찾기]가 이 값으로 화면을 가른다: 미설정이면 문자 인증코드 방식을 아예 보여주지 않고
//    기존 "관리자 승인" 방식으로 안내한다. 안 그러면 "코드를 보냈다"고 해놓고 영영 안 오는 화면이 된다.
//  · 계정 값 자체는 절대 밖으로 내보내지 않는다 — 있고 없음만 알린다.
export function smsConfigured(): boolean {
  return account() !== null;
}

// .env 계정. 하나라도 없으면 null(→ 발송 안 함, 안전 실패).
function account(): { id: string; pw: string; sender: string } | null {
  const id = process.env.IONE_SMS_ID;
  const pw = process.env.IONE_SMS_PW;
  const sender = process.env.IONE_SMS_SENDER;
  if (!id || !pw || !sender) return null;
  return { id, pw, sender: normalizePhone(sender) };
}

// 아이원24 응답 해석(순수함수, 테스트용). 응답 body가 비어있으면 성공.
export function interpretSmsResponse(httpOk: boolean, status: number, respText: string): SmsResult {
  if (!httpOk) return { ok: false, detail: `발송 서버 오류(HTTP ${status})` };
  const t = (respText ?? "").trim();
  if (t === "") return { ok: true, detail: "발송 성공" };
  return { ok: false, detail: t };
}

export type SmsResult = { ok: boolean; detail: string };

// 문자 1건 발송. text 길이에 따라 SMS/LMS 자동 구분. 예외·미설정은 던지지 않고 결과로 반환한다.
//  · companyId·purpose는 **필수**다 — 빠뜨리면 회사별 상한·보안 문자 몫이 조용히 무력화된다(검수 C-1).
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

  const sms = isSmsType(text);
  const params: Record<string, string> = {
    pslma: sms ? "0" : "1",
    pid: acc.id,
    ppwd: acc.pw,
    pdestphone: to,
    psendphone: acc.sender,
    psubject: sms ? "" : (opts.subject ?? "근태관리 알림"), // 제목은 LMS만 의미 있음
    pmsg: text,
    purl: "",
    pyellowkey: "",
    ptemplatecode: "",
    presend: "",
    pfilename: "",
    pfilebyte: "",
  };

  try {
    const res = await fetch(sendUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=euc-kr" },
      body: eucKrFormBody(params), // 이미 %인코딩된 ASCII 문자열
      signal: AbortSignal.timeout(10000), // 아이원24 무응답 시 서버액션이 매달리지 않게 10초 제한
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const respText = iconv.decode(buf, "euc-kr");
    return interpretSmsResponse(res.ok, res.status, respText);
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "문자 발송 중 오류가 발생했습니다." };
  }
}
