// KIS(KISPG) 결제 설정 읽기 — 2026-11-23 결제 1단계(plan-근태결제-개발.md).
//
// 🔴 값이 하나라도 비면 **결제하지 않는다**("준비 중"). 지금 근태관리는 KIS 상점이 없다 —
//    학원관리 상점(01m·02m)은 KIS 회신 9번에 따라 다른 도메인 서비스에 쓸 수 없고, 근태관리용은 사전 RM 심사 뒤 따로 받는다.
//    그 전에는 운영 .env에 아무것도 넣지 않는다 → 이 함수가 null을 돌려주고, 화면은 [결제하기] 대신 "준비 중"을 보인다.
// 🔴 상점키(merchantKey)는 서버에서만 쓴다. 화면·로그·응답에 내보내지 않는다(결제창에는 암호값만 간다).
// ⚠️ 서버 전용 — 화면(클라이언트) 코드에서 import하지 말 것.
//
// 운영 .env에 넣을 이름(값은 KIS가 준다 — 저장소에 적지 않는다):
//   KISPG_MID / KISPG_MERCHANT_KEY                 일반 결제 상점ID·상점키
//   KISPG_BILLING_MID / KISPG_BILLING_MERCHANT_KEY 자동결제(빌링) 상점ID·상점키 — 일반과 따로 발급(KIS 회신 4번)
//   KISPG_API_URL                                  KIS 주소(시험 testapi / 운영 api — 결제 도구의 TEST_API_URL·LIVE_API_URL 중 하나)
//   KISPG_RETURN_URL                               결제창 결과를 받는 우리 주소(2단계에서 만든다)
//   KISPG_MAX_AMOUNT                               1회 결제 한도(원, 부가세 포함 총액). 없으면 lib/pricing.ts KIS_MAX_TOTAL

export type KispgMerchant = { mid: string; merchantKey: string; apiUrl: string };

export type KispgConfig = {
  normal: KispgMerchant | null;  // 일반 결제 — 없으면 [결제하기] "준비 중"
  billing: KispgMerchant | null; // 자동결제 — 없으면 [자동결제 신청] "준비 중"
  returnUrl: string | null;
  maxAmount: number | null;
};

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function merchant(midName: string, keyName: string, apiUrl: string | null): KispgMerchant | null {
  const mid = env(midName);
  const merchantKey = env(keyName);
  if (!mid || !merchantKey || !apiUrl) return null;
  return { mid, merchantKey, apiUrl };
}

/** 결과를 받을 주소는 https만(내 컴퓨터 시험용 http://localhost 예외). 아니면 null — 결제하지 않는다(검수 경미 6). */
function safeReturnUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return raw;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return raw;
  } catch {
    /* 형식이 틀린 주소 — 아래에서 null */
  }
  console.error("[kispg-config] KISPG_RETURN_URL이 https 주소가 아니라 결제를 막습니다.");
  return null;
}

/** 지금 서버의 결제 설정. 비어 있는 쪽은 null — 부르는 쪽은 null이면 결제하지 않는다. */
export function readKispgConfig(): KispgConfig {
  // 상점키가 든 객체다. 화면(브라우저) 코드에서 불리면 즉시 멈춘다 — 주석만으로는 막을 수 없다(검수 경미 6).
  if (typeof window !== "undefined") throw new Error("[kispg-config] 서버 전용 — 화면 코드에서 부를 수 없습니다.");
  const apiUrl = env("KISPG_API_URL");
  const returnUrl = safeReturnUrl(env("KISPG_RETURN_URL"));
  const rawMax = env("KISPG_MAX_AMOUNT");
  const max = rawMax ? Number(rawMax) : NaN;
  return {
    // 결과를 받을 주소가 없으면 결제창을 띄워도 돌아올 곳이 없다 → 일반·자동결제 둘 다 "준비 중".
    normal: returnUrl ? merchant("KISPG_MID", "KISPG_MERCHANT_KEY", apiUrl) : null,
    billing: returnUrl ? merchant("KISPG_BILLING_MID", "KISPG_BILLING_MERCHANT_KEY", apiUrl) : null,
    returnUrl,
    maxAmount: Number.isInteger(max) && max > 0 ? max : null,
  };
}
