// [결제창 결과 받기] KIS 결제창이 끝나면 화면이 받은 결과를 이 주소로 form POST한다(KISPG_RETURN_URL) — 2026-11-23 결제 2단계.
//
// · 로그인 검사를 하지 않는다(학원관리와 같다). 위조된 값이 와도 해가 없게 만들어 두었기 때문이다:
//   주문서는 우리 DB에서 찾고 금액도 DB 값으로 승인하며, 승인은 우리 상점키로만 된다(lib/billing-pay.ts 머리말 ①).
// · 처리 결과와 상관없이 결과 화면으로 303 이동한다. 성공·실패 판단은 서버가 하고, 화면은 DB 상태를 보여 줄 뿐이다.
// · 이동할 주소는 **설정의 반환 주소 기준**으로 만든다 — 요청의 Host 머리말을 믿지 않는다(프록시 뒤 내부 주소·조작 방지).
import { NextResponse } from "next/server";
import { handlePayReturn } from "@/lib/billing-pay";
import { handleCardReturn, REG_NO_RE } from "@/lib/billing-auto";
import { readKispgConfig } from "@/lib/kispg-config";

export const dynamic = "force-dynamic";

function siteOrigin(req: Request): string {
  const ret = readKispgConfig().returnUrl;
  if (ret) {
    try {
      return new URL(ret).origin;
    } catch {
      /* 아래 */
    }
  }
  return new URL(req.url).origin;
}

/** 결제창 결과는 몇백 바이트다. 로그인 없는 주소라 큰 본문은 읽기 전에 거른다(2단계 검수 경미 7). */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const body: Record<string, unknown> = {};
  // 길이 머리말이 없는 요청(chunked)은 크기를 미리 알 수 없어 받지 않는다 — 브라우저 form POST는 늘 길이를 보낸다(재검수 경미 3).
  const rawLen = req.headers.get("content-length");
  const len = rawLen === null ? NaN : Number(rawLen);
  if (!Number.isFinite(len) || len > MAX_BODY_BYTES) {
    return NextResponse.redirect(new URL("/subscription/result", siteOrigin(req)), 303);
  }
  try {
    const form = await req.formData();
    form.forEach((v, k) => {
      if (typeof v === "string") body[k] = v.slice(0, 2000); // 파일·지나치게 긴 값은 받지 않는다
    });
  } catch {
    // form이 아니면 빈 값 — 아래에서 주문을 못 찾아 결과 화면(안내)으로 간다.
  }
  // 결제창(HR-)과 자동결제 카드 등록 창(HRB-, 2026-11-23 결제 3단계)은 같은 반환 주소를 쓴다 → 주문번호 앞머리로 가른다.
  const to = new URL("/subscription/result", siteOrigin(req));
  const ordNo = typeof body.ordNo === "string" ? body.ordNo.trim() : "";
  if (REG_NO_RE.test(ordNo)) {
    try {
      const r = await handleCardReturn(body);
      if (r.regNo) to.searchParams.set("regNo", r.regNo);
    } catch (e) {
      console.error("[billing/return] 카드 등록 처리 오류:", e instanceof Error ? e.name : "unknown");
    }
    return NextResponse.redirect(to, 303);
  }
  let orderNo: string | null = null;
  try {
    orderNo = await handlePayReturn(body);
  } catch (e) {
    console.error("[billing/return] 처리 오류:", e instanceof Error ? e.message : String(e));
  }
  if (orderNo) to.searchParams.set("orderNo", orderNo);
  return NextResponse.redirect(to, 303);
}

/** 주소창에 직접 들어온 경우 — 요금 화면으로. */
export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/subscription", siteOrigin(req)), 303);
}
