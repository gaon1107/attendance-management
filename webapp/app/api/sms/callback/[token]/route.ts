// [비즈모아샷] 문자 발송결과 회신 받기 (2026-11-22, 메시지 관리 3-3)
//  문자를 보낼 때 함께 넘긴 주소(lib/sms.ts smsCallbackUrl)로 비즈모아샷이 결과를 POST 해 준다.
//  해석·기록은 lib/sms-callback.ts가 한다. 이 파일은 **문을 지키고 본문을 넘겨주는 일**만 한다.
//
// 🔴 로그인 없이 외부가 부르는 유일한 주소다. 지키는 규칙:
//  ① 주소 끝의 토큰이 운영 설정값(MOASHOT_CALLBACK_TOKEN)과 다르면 **404**.
//     (토큰이 맞는지는 알려주지 않는다. 다만 "이 주소 자체가 있다"는 응답 모양으로 구분될 수 있다 —
//      본문 없는 404 vs 없는 주소의 안내 화면. 토큰 없이는 아무것도 못 하므로 그대로 둔다. 검수 경미 1.)
//     글자 수만 맞고 바이트 수가 다른 값으로 예외를 터뜨리는 공격을 막기 위해 길이를 먼저 맞춘 뒤 비교하고,
//     비교는 timingSafeEqual로 한다(앞자리부터 한 글자씩 맞춰 보는 공격 방지).
//  ② 토큰이 맞을 때만 본문을 읽는다. 너무 큰 본문은 읽지 않고 버린다.
//  ③ 응답은 **언제나 200 "OK"** — 비즈모아샷이 재시도를 쏟아붓지 않게. 우리 쪽 오류는 서버 기록으로만 남긴다.
//  ④ 본문에는 수신 전화번호가 들어 있다 → **통째로 기록에 남기지 않는다**(lib/sms-callback.ts도 같은 규칙).
import { timingSafeEqual } from "crypto";
import { after } from "next/server";
import { applySmsCallback } from "@/lib/sms-callback";

/** 토큰 허용 형식 — 보내는 쪽(lib/sms.ts CALLBACK_TOKEN_PATTERN)과 **같은 규칙**이어야 한다. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
/**
 * 받아 읽을 최대 본문 크기.
 *  결과 200건(lib/sms-callback.ts MAX_RESULTS_PER_REQUEST)이면 넉넉잡아 10KB 남짓이다. 64KB면 충분하고,
 *  그보다 크면 우리 회신이 아니거나 부하 공격이므로 읽지 않는다.
 */
const MAX_BODY_BYTES = 64 * 1024;

/** 언제나 같은 응답(200 OK). 성공·실패·무시 어느 경우에도 이것만 돌려준다. */
function ok(): Response {
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** 주소의 토큰이 운영 설정값과 같은가. 어떤 입력에도 예외를 던지지 않는다. */
function isValidToken(token: string): boolean {
  try {
    const expected = (process.env.MOASHOT_CALLBACK_TOKEN ?? "").trim();
    // 설정이 없으면 회신을 아예 받지 않는다(발송 쪽도 주소를 안 붙인다).
    if (!expected) return false;
    if (!TOKEN_PATTERN.test(token) || !TOKEN_PATTERN.test(expected)) return false;
    const a = Buffer.from(token, "utf8");
    const b = Buffer.from(expected, "utf8");
    // 🔴 바이트 길이가 다르면 timingSafeEqual이 예외를 던진다 — 먼저 맞춰 본다.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) {
    // 토큰이 틀리면 본문을 읽지도 않는다. 404 = "그런 주소 없음"으로 보이게 한다.
    return new Response(null, { status: 404 });
  }

  // 미리 알려 주는 크기가 상한을 넘으면 읽지 않는다(실제 크기는 아래에서 한 번 더 본다).
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    console.warn(`[sms-callback] 본문이 너무 커서 읽지 않는다(${declared}바이트).`);
    return ok();
  }

  let raw = "";
  try {
    // 🔴 Content-Type을 보지 않고 글자 그대로 읽는다 — 비즈모아샷은 형식 표시 끝에 `;`를 붙여 보내는데,
    //    일반 양식 해석기는 그 표시를 모르는 형식으로 보고 본문을 비워 버린다(학원관리 운영 사고 2026-10-03).
    raw = await req.text();
  } catch (e) {
    console.error("[sms-callback] 본문 읽기 실패:", e instanceof Error ? e.message : String(e));
    return ok();
  }
  if (raw.length > MAX_BODY_BYTES) {
    console.warn(`[sms-callback] 본문이 너무 커서 버린다(${raw.length}자).`);
    return ok();
  }

  // 비즈모아샷에는 먼저 200을 준다(재시도 폭주 방지). 기록 갱신은 응답을 보낸 뒤에 한다.
  //  · applySmsCallback은 예외를 밖으로 던지지 않는다 — 여기서 더 감쌀 것이 없다.
  after(() => applySmsCallback(raw));
  return ok();
}
