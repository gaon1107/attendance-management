// 비즈모아샷 발송 주소(.env MOASHOT_SEND_URL) 검사 — 서버 전용. 의존 없는 작은 파일.
//  · lib/sms.ts(발송)와 lib/company-sms-account.ts(연결 판정)가 **함께** 쓴다. 한 파일에 두면 두 파일이 서로를
//    불러오는 순환 참조가 생겨서 따로 뗐다(2026-11-21, 메시지 관리 2단계 검수 L-4).
//  · 규칙은 공용 모듈(@newgaon/moashot sms.js isSecureSendUrl)과 같다 — https만, 시험용 내 컴퓨터 주소만 http 허용.
//    비밀번호를 싣고 가는 요청이라 http(평문)로는 절대 보내지 않는다.

/** 이 주소로 보내도 되는가. */
export function isAllowedSendUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 회사 계정 발송에 쓸 발송 주소가 서버에 설정돼 있는가(.env MOASHOT_SEND_URL).
 *  · 가온 계정과 달리 아이디·비밀번호는 회사가 넣으므로 **주소만** 본다.
 *  · 개발 PC처럼 주소가 없으면 회사 문자는 하나도 나가지 않는다(실수 발송 방지).
 */
export function companySmsSendAvailable(): boolean {
  const sendUrl = (process.env.MOASHOT_SEND_URL ?? "").trim();
  return !!sendUrl && isAllowedSendUrl(sendUrl);
}
