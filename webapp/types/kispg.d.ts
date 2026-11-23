// @newgaon/kispg(학원관리 newgaon-LMS/backend/lib/kispg 공용 결제 모듈)의 타입 선언 — 근태가 **쓰는 것만** 적는다.
//  · 원본 모듈은 JavaScript라 타입이 없다. 반환 모양은 원본 payment.js 주석·코드를 그대로 옮겼다(2026-11-23, 0.2.0).
//  · ⚠️ 모듈 버전을 올리면 README 변경 이력과 이 선언을 함께 대조할 것.
//  · 🔴 approve·cancel·inquire는 예외를 던지지 않는다 — 모든 문제는 { ok:false, error }로 돌아온다.
//     buildAuthRequest만 입력이 잘못되면 한글 예외를 던진다(부르는 쪽이 잡아 안내).
declare module "@newgaon/kispg" {
  export interface KispgConfig {
    mid: string;
    /** 🔴 서버에서만 — 브라우저로 보내지 않는다. 모듈도 결과에 넣지 않는다. */
    merchantKey: string;
    /** TEST_API_URL 또는 LIVE_API_URL(https). 내 컴퓨터 http://localhost만 예외. */
    apiUrl: string;
  }

  export const LIVE_API_URL: string;
  export const TEST_API_URL: string;
  export const VERSION: string;

  export interface AuthOrder {
    ordNo: string;
    goodsNm: string;
    goodsAmt: number;
    ordNm: string;
    /** 숫자만 0으로 시작 9~11자리(하이픈은 모듈이 지운다). */
    ordTel: string;
    returnUrl: string;
    payMethod?: "CARD" | "BANK" | "VACNT" | "PHONE" | "";
    model?: "WEB" | "MOB";
    ordEmail?: string;
    mbsReserved?: string;
  }
  /** 결제창으로 보낼 값 — 화면이 action 주소로 fields를 iframe에 form POST한다(_self로 넘기면 결과를 받을 곳이 없다). */
  export function buildAuthRequest(input: { config: KispgConfig; order: AuthOrder; now?: Date }): {
    action: string;
    fields: Record<string, string>;
  };

  export interface AuthResult {
    /** 인증 성공(0000) + 거래번호 있음. **아직 돈이 빠진 것이 아니다** — approve를 불러야 결제된다. */
    ok: boolean;
    resultCd: string;
    resultMsg: string;
    payMethod: string;
    tid: string;
    ordNo: string;
    amt: string;
    ediDate: string;
    encData: string;
    mbsReserved: string;
  }
  export function parseAuthResult(body: Record<string, unknown>): AuthResult;
  /** 응답 암호값 검사. ⚠️ KIS 실제 시험으로 확정 전 — 이 값만으로 결제를 막지 않는다(학원관리도 "기록만"). */
  export function verifyAuthResult(input: { config: KispgConfig; result: AuthResult }): boolean;

  export interface ApproveResult {
    ok: boolean;
    /** 돈이 빠졌는지 모름 → inquire로 확인. 실패로 단정 금지. */
    uncertain: boolean;
    /** 승인은 났지만 금액이 다름 → amt(실제 승인 금액)로 즉시 cancel. */
    amountMismatch?: boolean;
    resultCd: string;
    resultMsg: string;
    payMethod?: string;
    tid: string;
    appNo?: string;
    appDtm?: string;
    ordNo?: string;
    amt?: number | null;
    fnNm?: string;
    /** KIS가 가린 카드번호. */
    cardNo?: string;
    cardType?: string;
    cancelYN?: string;
    error: string | null;
  }
  export function approve(input: { config: KispgConfig; tid: string; goodsAmt: number; ordNo?: string; now?: Date }): Promise<ApproveResult>;

  export interface CancelResult {
    ok: boolean;
    uncertain: boolean;
    /** 이미 취소된 거래(2004·2013) — 다시 취소할 필요 없음. */
    alreadyCancelled: boolean;
    resultCd: string;
    resultMsg: string;
    tid: string;
    amt?: number | null;
    error: string | null;
  }
  export function cancel(input: {
    config: KispgConfig;
    tid: string;
    payMethod: string;
    canAmt: number;
    canMsg: string;
    ordNo?: string;
    now?: Date;
  }): Promise<CancelResult>;

  export interface InquireResult {
    found: boolean;
    /** "돈이 안 빠졌다"고 볼 수 있는 것은 not_found 하나뿐. unknown은 다시 조회한다. */
    status: "approved" | "cancelled" | "waiting" | "not_found" | "unknown";
    uncertain: boolean;
    amountMismatch: boolean;
    resultCd: string;
    resultMsg: string;
    tid: string;
    ordNo: string;
    amt: number | null;
    payMethod: string;
    appNo: string;
    appDtm: string;
    cancelYN: string;
    error: string | null;
  }
  export function inquire(input: { config: KispgConfig; tid?: string; ordNo?: string; goodsAmt: number; now?: Date }): Promise<InquireResult>;
}
