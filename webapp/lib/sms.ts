// 아이원24(iOne24) 문자 발송 — 초대·임시비밀번호 발송용(부가 수단).
// 원본: newgaon-LMS/SMS_연동_이식_가이드.md (Java/GFKids)의 API 규격을 TypeScript로 재구현.
// 규격: POST form-urlencoded(본문 EUC-KR) / 응답 body 비어있으면 성공 / 90byte 이하=SMS·초과=LMS.
// ※ 계정(발신ID·비번·발신번호)은 .env에서만 읽는다(하드코딩 금지). 미설정이면 안전하게 실패 반환.
import iconv from "iconv-lite";

const SEND_URL = process.env.IONE_SMS_SEND_URL || "http://smsmsgr.ione24.com/slma_action_gaon.ashx";

// EUC-KR 기준 바이트 길이(한글 2·ASCII 1). SMS/LMS 구분에 사용.
export function smsByteLength(text: string): number {
  return iconv.encode(text ?? "", "euc-kr").length;
}

// 90바이트 이하면 SMS(pslma=0), 초과면 LMS(pslma=1).
export function isSmsType(text: string): boolean {
  return smsByteLength(text) <= 90;
}

// 전화번호에서 숫자만 남긴다(하이픈·공백 제거).
export function normalizePhone(phone: string): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

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
export async function sendSms(opts: { to: string; text: string; subject?: string }): Promise<SmsResult> {
  const acc = account();
  if (!acc) return { ok: false, detail: "문자 발송계정이 설정되지 않았습니다(.env)." };

  const to = normalizePhone(opts.to);
  if (to.length < 9 || to.length > 12) return { ok: false, detail: "수신 전화번호가 올바르지 않습니다." };

  const text = opts.text ?? "";
  if (text.trim() === "") return { ok: false, detail: "보낼 내용이 없습니다." };

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
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=euc-kr" },
      body: eucKrFormBody(params), // 이미 %인코딩된 ASCII 문자열
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const respText = iconv.decode(buf, "euc-kr");
    return interpretSmsResponse(res.ok, res.status, respText);
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "문자 발송 중 오류가 발생했습니다." };
  }
}
