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

import type { NextRequest } from "next/server";

// 정소장님이 준 기본 호출 주소 (화면에서 바꿀 수 있음)
const DEFAULT_URL = "http://tapprsys.ione24.com/_appr/card_appr.ashx?pkind=appr";

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

  // 화면에서 보낸 요청 정보 읽기
  let input: {
    url?: string;
    method?: string;
    contentType?: string;
    authorization?: string;
    body?: string;
  };
  try {
    input = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "요청 형식이 올바르지 않습니다.(JSON 아님)" },
      { status: 400 },
    );
  }

  const targetUrl = (input.url || DEFAULT_URL).trim();
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
    const res = await fetch(targetUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : bodyText,
      signal: controller.signal,
      // 캐시 없이 매번 실제 호출
      cache: "no-store",
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
    });
  }
}
