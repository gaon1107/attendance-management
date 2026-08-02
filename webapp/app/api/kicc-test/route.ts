// 아이원(ione24) 결제 테스트 호출 — 서버 경유 프록시
//
// 왜 서버를 거치나?
//  - 브라우저에서 외부 주소(http://tapprsys.ione24.com)를 직접 부르면
//    ① CORS 차단 ② https 화면 → http 주소(혼합 콘텐츠) 차단에 막힌다.
//  - 그래서 우리 화면 → (이 서버 핸들러) → 아이원 서버 순으로 대신 호출하고,
//    돌아온 응답을 그대로 화면에 돌려준다. (근태관리 본체는 건드리지 않는 별도 테스트용)
//
// 이 파일이 하는 일: 화면에서 받은 요청 정보로 아이원 주소를 호출하고,
// 응답(상태·본문·JSON)을 읽어서 화면으로 돌려준다.
//
// 🔒 안전장치 3중 (2026-08-02 종합검수 C-1 반영 — 이 3가지를 절대 빼지 말 것):
//   ① 관리자 로그인 필수      — 예전엔 누구나 호출할 수 있었다.
//   ② 목적지 화이트리스트     — 결제사 주소만. 임의 주소 호출 금지.
//   ③ 리다이렉트 자동추적 금지 — 허용 주소를 경유한 내부망 우회 차단.

import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isKiccTestEnabled } from "@/lib/kicc-test-flag";

// 정소장님이 준 기본 호출 주소 (화면에서 바꿀 수 있음)
const DEFAULT_URL = "http://tapprsys.ione24.com/_appr/card_appr.ashx?pkind=appr";

// 🔒 호출을 허용할 목적지 (아이원/KICC 계열만).
//    이 목록이 없으면 "아무 주소나 우리 서버가 대신 호출해 주는 창구"가 되어
//    외부인이 사내망·클라우드 내부주소를 들여다보는 통로로 악용된다(검수 C-1).
const ALLOWED_HOSTS = [
  "tapprsys.ione24.com", // 아이원 테스트 결제
  "apprsys.ione24.com", // 아이원 운영 결제(추후)
  "testpaygate.kicc.co.kr", // KICC 테스트
  "paygate.kicc.co.kr", // KICC 운영(추후)
];

// 목적지 주소가 허용 목록에 있는지 확인한다. 통과 못 하면 사유를 돌려준다.
// ※ 이름(호스트)만 검사하며, 그 이름이 실제로 어떤 IP로 풀리는지는 검사하지 않는다.
//   결제사 도메인만 허용하므로 실무상 충분하지만, DNS가 오염된 환경에서는 완전하지 않다.
function checkTarget(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "주소 형식이 올바르지 않습니다." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `허용하지 않는 프로토콜입니다.(${url.protocol})` };
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) {
    return {
      ok: false,
      reason: `허용하지 않는 주소입니다.(${host}) — 결제사 주소만 호출할 수 있습니다. 목록: ${ALLOWED_HOSTS.join(", ")}`,
    };
  }
  // 포트도 막는다 — 허용 호스트라도 임의 포트를 열어주면 결제사 서버 포트 스캔 도구가 된다.
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: `허용하지 않는 포트입니다.(${url.port}) — 기본 포트만 사용할 수 있습니다.` };
  }
  return { ok: true, url };
}

// content-type 헤더에서 charset(예: euc-kr)을 뽑아낸다. 없으면 utf-8.
function charsetOf(contentType: string | null): string {
  if (!contentType) return "utf-8";
  const m = contentType.match(/charset=([\w-]+)/i);
  if (!m) return "utf-8";
  const cs = m[1].toLowerCase();
  // 한국 결제 서버가 자주 쓰는 euc-kr / ks_c_5601 계열을 euc-kr로 통일
  if (cs === "ks_c_5601-1987" || cs === "ksc5601" || cs === "cp949") return "euc-kr";
  return cs;
}

export async function POST(request: NextRequest) {
  const started = Date.now();

  // 🔒 운영 빌드에서는 이 도구를 아예 없는 것으로 취급한다(화면 layout.tsx와 동일 기준).
  //    누구나 가입하면 자기 회사 관리자가 되는 구조라 role 검사만으로는 잠금이 되지 않는다.
  if (!isKiccTestEnabled()) {
    return Response.json({ ok: false, error: "사용할 수 없는 기능입니다." }, { status: 404 });
  }

  // 🔒 관리자만 사용할 수 있는 테스트 도구다. (로그인 없이 열려 있으면 외부 공격 통로가 된다)
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (me.role !== "admin") {
    return Response.json({ ok: false, error: "관리자만 사용할 수 있습니다." }, { status: 403 });
  }

  // 화면에서 보낸 요청 정보 읽기
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "요청 형식이 올바르지 않습니다.(JSON 아님)" },
      { status: 400 },
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return Response.json({ ok: false, error: "요청 내용이 올바르지 않습니다." }, { status: 400 });
  }

  // 각 항목이 "글자"인지 실제로 확인한다. (숫자·객체가 오면 .trim() 등에서 서버 오류 500이 나고,
  //  개발 모드 500 화면은 내부 파일 경로까지 노출한다 — 그래서 여기서 400으로 막는다)
  const rec = raw as Record<string, unknown>;
  const strField = (key: string): { ok: true; value: string | undefined } | { ok: false } => {
    const v = rec[key];
    if (v === undefined || v === null) return { ok: true, value: undefined };
    if (typeof v !== "string") return { ok: false };
    return { ok: true, value: v };
  };
  const fields: Record<string, string | undefined> = {};
  for (const key of ["url", "method", "contentType", "authorization", "body"]) {
    const f = strField(key);
    if (!f.ok) {
      return Response.json({ ok: false, error: `${key} 값은 글자여야 합니다.` }, { status: 400 });
    }
    fields[key] = f.value;
  }
  const input = fields as {
    url?: string;
    method?: string;
    contentType?: string;
    authorization?: string;
    body?: string;
  };

  const targetUrl = (input.url || DEFAULT_URL).trim();

  // 🔒 목적지 검사 — 결제사 주소가 아니면 호출하지 않는다.
  const target = checkTarget(targetUrl);
  if (!target.ok) {
    return Response.json(
      { ok: false, calledUrl: targetUrl, error: target.reason, durationMs: Date.now() - started },
      { status: 400 },
    );
  }

  const method = (input.method || "POST").toUpperCase();
  const contentType = input.contentType || "application/json";
  const authorization = input.authorization?.trim();
  const bodyText = input.body ?? "";

  // 아이원 서버로 보낼 헤더 구성
  const headers: Record<string, string> = {};
  if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = contentType;
  }
  if (authorization) headers["Authorization"] = authorization;

  // 응답 지연 대비: 최대 30초까지만 기다린다 (KICC 문서 권장값)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(target.url.toString(), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : bodyText,
      signal: controller.signal,
      // 캐시 없이 매번 실제 호출
      cache: "no-store",
      // 🔒 자동 리다이렉트 금지 — 허용된 결제사 주소가 다른 곳(사내망 등)으로
      //    보내더라도 따라가지 않는다. 리다이렉트는 응답으로만 보여준다.
      redirect: "manual",
    });

    // 응답 본문을 '글자 깨짐 없이' 읽기 — euc-kr일 수 있어 바이트로 받아 직접 디코딩
    const resContentType = res.headers.get("content-type");
    const charset = charsetOf(resContentType);
    const buf = await res.arrayBuffer();
    let rawText: string;
    try {
      rawText = new TextDecoder(charset).decode(buf);
    } catch {
      rawText = new TextDecoder("utf-8").decode(buf);
    }

    // 본문이 JSON이면 예쁘게 파싱해서 같이 돌려준다 (실패해도 원본은 보여줌)
    let json: unknown = null;
    let jsonError: string | null = null;
    const trimmed = rawText.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        json = JSON.parse(trimmed);
      } catch (e) {
        jsonError = e instanceof Error ? e.message : "JSON 해석 실패";
      }
    }

    clearTimeout(timer);
    return Response.json({
      ok: true, // "우리 서버가 호출을 끝까지 수행했다"는 뜻 (아이원 응답의 성공/실패와는 별개)
      calledUrl: targetUrl,
      method,
      httpStatus: res.status,
      httpStatusText: res.statusText,
      // 결제사가 "다른 주소로 가라(30x)"고 답하는 경우, 자동으로 따라가지 않는 대신
      // 어디로 가라고 했는지를 그대로 보여준다. (자동 추적은 내부망 우회 통로가 되므로 금지)
      redirectedTo: res.headers.get("location"),
      responseContentType: resContentType,
      charset,
      json,
      jsonError,
      rawText,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e instanceof Error && e.name === "AbortError";
    return Response.json({
      ok: false,
      calledUrl: targetUrl,
      method,
      error: aborted
        ? "응답이 30초 안에 오지 않아 중단했습니다.(서버 무응답/네트워크 문제)"
        : `호출 실패: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - started,
    }, { status: aborted ? 504 : 502 }); // 우리 서버는 정상이고 상대 서버 호출이 실패한 것
  }
}
