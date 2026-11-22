// @newgaon/moashot(학원관리 newgaon-LMS/backend/lib/moashot 공용 모듈)의 타입 선언 — 근태가 **쓰는 것만** 적는다.
//  · 원본 모듈은 JavaScript라 타입이 없다(README "근태관리(TypeScript)에서 쓰려면 index.d.ts 필요").
//  · ⚠️ 모듈 버전을 올리면 README 버전 이력과 이 선언을 함께 대조할 것(현재 0.3.2).
declare module "@newgaon/moashot" {
  export interface MoashotAccount {
    id: string;
    /** 비밀번호 평문 — 모듈이 https로만 보낸다(내 컴퓨터 http 예외). */
    password: string;
    /** 비즈모아샷에 사전등록된 발신번호. */
    sender: string;
  }
  export interface MoashotSmsInput {
    account: MoashotAccount;
    to: string | string[];
    text: string;
    /** 장문(LMS)일 때만 제목으로 붙는다. */
    title?: string;
    /** 결과 콜백 주소. 없으면 결과 콜백을 받지 않는다. */
    returnUrl?: string;
  }
  export interface MoashotSmsOptions {
    /** 🔴 비거나 없으면 발송하지 않고 실패를 돌려준다. */
    sendUrl: string;
    timeoutMs?: number;
  }
  export interface MoashotSmsResult {
    /** **접수** 성공 여부(전송 성공이 아니다 — 전송 결과는 콜백으로 온다). */
    ok: boolean;
    indexCode: string | null;
    indexCodes: string[];
    isShort: boolean;
    byteLength: number;
    raw: string;
    /** 실패 사유(한글). 성공이면 null. */
    error: string | null;
  }
  export const VERSION: string;
  export const DEFAULT_SEND_URL: string;
  export function sendSms(input: MoashotSmsInput, options: MoashotSmsOptions): Promise<MoashotSmsResult>;

  // ── 글자 처리(메시지 관리 3단계에서 사용) ────────────────────────────────
  //  비즈모아샷은 EUC-KR 기반이라 **바이트 수**로 단문/장문을 나누고, EUC-KR이 모르는 글자(이모지 등)는 깨진다.
  /** 단문(SMS) 최대 바이트. 넘으면 장문(LMS). */
  export const MAX_SHORT_BYTES: number;
  /** 장문(LMS) 최대 바이트. 넘으면 접수 자체가 거부된다. */
  export const MAX_LONG_BYTES: number;
  /** EUC-KR로 바꿨을 때의 바이트 수(한글 2, 영문·숫자 1). */
  export function getEuckrByteLength(text: string | null | undefined): number;
  /** 단문으로 나가는 길이인가. */
  export function isShortMessage(text: string | null | undefined): boolean;
  /** EUC-KR로 표현할 수 없어 깨지는 글자 목록(중복 제거). 없으면 빈 배열. */
  export function findUnsupportedChars(text: string | null | undefined): string[];

  // ── 발송결과 회신 해석(메시지 관리 3-3에서 사용) ──────────────────────────
  //  비즈모아샷이 우리 서버로 보내는 결과 본문을 푼다. 매뉴얼의 함정 두 가지(여러 건이 "접수ID,코드,…"로
  //  이어붙음 / 항목 이름 대소문자 뒤섞임)를 모듈이 흡수한다 — 원본 주석: node_modules/@newgaon/moashot/callback.js
  export interface MoashotCallbackResult {
    /** 접수번호(발송 때 받은 indexCode와 같은 값). */
    indexCode: string;
    /** 결과코드 원문(예 "1" 전송성공, "46" 잔액 부족). */
    code: string;
    /** 전송 성공 여부. */
    ok: boolean;
    /** 결과 사유(한글). 모르는 코드면 "알 수 없는 결과코드(..)". */
    reason: string;
  }
  export interface MoashotParsedCallback {
    /** nType — 1 접수 / 2 전송결과 / 3 둘 다. 없으면 null. */
    type: number | null;
    /** 접수 정보(nType 1·3). errMsg가 비어 있지 않으면 접수 자체가 거부된 것이다. */
    accepted: { indexCodes: string[]; title: string; toNumber: string; errMsg: string } | null;
    /** 전송 결과(nType 2·3). 없으면 빈 배열. */
    results: MoashotCallbackResult[];
    sendStart: string;
    sendEnd: string;
    /** 알림톡이 실패해 문자로 대체 발송된 결과인가. */
    reSend: boolean;
  }
  /** 결과 본문(양식 형식을 푼 객체)을 해석한다. 예외를 던지지 않는다. */
  export function parseCallback(
    body: Record<string, unknown>,
    options?: { channel?: "sms" | "kakao" }
  ): MoashotParsedCallback;
}
