// 문자 템플릿 — 기본 문구(가온 제공) + 바꿔 넣는 자리 + 길이·글자 검사. 메시지 관리 3단계(2026-11-22).
//
// 🔑 기본 템플릿은 **DB에 넣지 않는다.** 여기 상수로만 둔다.
//    · 회사마다 복사해 두면 문구를 고칠 때 모든 회사의 행을 손봐야 하고, 가입할 때마다 심어야 한다.
//    · 회사가 기본 문구를 고쳐 쓰면 그때 **복사본이 SmsTemplate 표에 생긴다**(원본은 그대로 남는다).
//
// ⚠️ 이 파일은 **화면(클라이언트)에서도 불린다** — 서버 전용 모듈(prisma·@newgaon/moashot)을 여기서 import하지 말 것.
//    그래서 여기 검사는 **느슨하다**(브라우저에는 EUC-KR 변환기가 없다). 진짜 관문은 서버 액션이고, 거기서
//    공용 모듈(@newgaon/moashot findUnsupportedChars·getEuckrByteLength)로 **다시 판정한다**
//    — app/actions/sms-templates.ts.
//    🔴 2026-11-22 검수 중간 1: 예전엔 "서버가 거른다"고 적어 두고 실제로 거르는 곳이 없어서, 깨지는 글자가
//       그대로 접수되고 **요금까지 나갈** 상태였다(공용 모듈 sendSms는 길이만 본다). 이 짝을 끊지 말 것.

/** 보낼 때 실제 값으로 바뀌는 자리. 대괄호까지 그대로 적는다. */
export const TEMPLATE_VARS = [
  { key: "[직원명]", desc: "받는 직원의 이름" },
  { key: "[회사명]", desc: "우리 회사 이름" },
  { key: "[날짜]", desc: "보내는 날짜 (예: 11월 22일)" },
  { key: "[내용]", desc: "보낼 때 직접 적는 내용" },
] as const;

/** 기본 템플릿(가온 제공) — 2026-11-22 사장님 승인 목록. */
export const DEFAULT_TEMPLATES: { id: string; name: string; body: string }[] = [
  { id: "notice", name: "공지 안내", body: "[회사명] 새 공지가 등록되었습니다. [내용]" },
  { id: "no-clock-in", name: "출근 기록 없음", body: "[직원명]님, 오늘 출근 기록이 없습니다. 확인 부탁드립니다." },
  { id: "no-clock-out", name: "퇴근 기록 없음", body: "[직원명]님, [날짜] 퇴근 기록이 없습니다. 근태 정정을 신청해 주세요." },
  { id: "leave-result", name: "휴가 결재 결과", body: "[직원명]님, 신청하신 휴가가 [내용]되었습니다." },
  { id: "correction-ask", name: "근태 정정 요청", body: "[직원명]님, [날짜] 근태 기록 확인이 필요합니다. 정정을 신청해 주세요." },
  { id: "schedule", name: "일정 안내", body: "[회사명] [내용]" },
];

/** 한 회사가 만들 수 있는 템플릿 수 — 목록이 끝없이 길어지는 것을 막는 안전장치. */
export const TEMPLATE_MAX_PER_COMPANY = 50;
/**
 * [메시지 발송]에서 **한 번에** 보낼 수 있는 최대 인원(2026-11-22, 3-2b).
 *  · 실수로 전체에게 두 번 보내는 사고를 작게 만든다. 더 보내야 하면 나눠서 보낸다.
 *  · ⚠️ 여기 두는 이유: 서버 액션 파일("use server")은 **함수 말고는 내보낼 수 없어** 화면이 읽지 못한다.
 */
export const SEND_MAX_RECIPIENTS = 30;
/** 템플릿 이름 길이 상한(글자 수). 본문의 진짜 한계는 아래 바이트 기준이다. */
export const TEMPLATE_NAME_MAX = 30;

// ── 길이(바이트) ────────────────────────────────────────────────────────────
// 비즈모아샷은 EUC-KR 기준이라 **글자 수가 아니라 바이트**로 단문/장문을 나눈다.
//  ⚠️ 공용 모듈 값과 같아야 한다(@newgaon/moashot MAX_SHORT_BYTES·MAX_LONG_BYTES). 한쪽만 바꾸지 말 것.
export const SMS_SHORT_MAX_BYTES = 90;
export const SMS_LONG_MAX_BYTES = 2000;

/**
 * EUC-KR 바이트 수 — 화면에서 쓰는 계산.
 *  · ASCII(영문·숫자·기본 기호)는 1바이트, 그 밖(한글·한자·전각 기호)은 2바이트.
 *  · EUC-KR에 아예 없는 글자(이모지 등)는 어차피 보낼 수 없어 따로 막는다(findUnsupportedPreview).
 *    그래서 "보낼 수 있는 글자"에 한해 이 계산은 서버(iconv) 결과와 같다.
 */
export function countSmsBytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    n += code < 128 ? 1 : 2;
  }
  return n;
}

/** 단문으로 나가는 길이인가(요금이 싸다). */
export function isShortSms(text: string): boolean {
  return countSmsBytes(text) <= SMS_SHORT_MAX_BYTES;
}

/**
 * 맥·아이폰에서 복사한 한글 등을 **합친 형태로 맞춘다**(NFC 정규화).
 *  🔴 [2026-11-22 검수 중간 1] 분해형 한글(NFD: 자음·모음이 쪼개진 형태)은 화면에는 멀쩡히 보이는데
 *     EUC-KR로 바꾸면 물음표로 **깨져서 나가고 요금도 나간다.** 맥·아이폰·일부 웹에서 복사하면 이 형태다.
 *     저장할 때 한 번 맞춰 두면 그 뒤로는 전부 정상 글자로 다룬다.
 */
export function normalizeTemplateText(text: string): string {
  return text.normalize("NFC");
}

/**
 * 문자로 보낼 수 없는 글자 찾기 — 화면에서 **미리 알려주기** 위한 것.
 *  · EUC-KR에 없는 글자는 받는 사람 폰에서 깨진다. 대표적으로 **이모지**다.
 *  · 여기서는 **확실한 것만** 잡는다. 별표·전화기표 같은 기호는 EUC-KR에 있어 정상 발송되므로 막지 않는다
 *    (검수 중간 1: 예전엔 그 구간을 통째로 막아 "★필독★ 공지" 같은 템플릿을 만들 수 없었다).
 *  · 못 잡은 글자는 **서버 액션이 공용 모듈로 다시 걸러** 저장을 막는다.
 */
export function findUnsupportedPreview(text: string): string[] {
  const bad: string[] = [];
  for (const ch of normalizeTemplateText(text)) {
    const code = ch.codePointAt(0) ?? 0;
    // BMP 밖(0x10000 이상) = 이모지 대부분·희귀문자. EUC-KR에 없다.
    const isOutsideBmp = code > 0xffff;
    // 이모지 변형 선택자·사용자 지정 영역(폰트마다 다른 그림). EUC-KR에 없다.
    const isKnownBad = (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe000 && code <= 0xf8ff);
    if ((isOutsideBmp || isKnownBad) && !bad.includes(ch)) bad.push(ch);
  }
  return bad;
}

/**
 * 대괄호로 적었지만 **바뀌지 않는** 자리를 찾는다(검수 중간 6).
 *  · 바뀌는 것은 TEMPLATE_VARS 4개뿐이다. 다른 말을 대괄호로 적으면 그 글자 그대로 직원 휴대폰에 나간다.
 *  · 막지는 않는다 — "[긴급]"처럼 일부러 대괄호를 쓰는 문구도 정상이다. **알려만 준다.**
 */
export function findUnknownVars(text: string): string[] {
  const known: string[] = TEMPLATE_VARS.map((v) => v.key);
  const found: string[] = [];
  for (const m of text.matchAll(/\[[^[\]]{1,20}\]/g)) {
    const token = m[0];
    if (!known.includes(token) && !found.includes(token)) found.push(token);
  }
  return found;
}

/**
 * 템플릿 본문의 자리를 실제 값으로 바꾼다.
 *  · 값이 없는 자리는 **지운다**(대괄호가 그대로 나가면 받는 사람이 오류로 본다).
 *  · 바꿔 넣는 값 안에 또 `[직원명]` 같은 글자가 있어도 **다시 바꾸지 않는다**(한 번만 훑는다).
 */
export function renderTemplate(
  body: string,
  values: { 직원명?: string; 회사명?: string; 날짜?: string; 내용?: string },
): string {
  return body.replace(/\[(직원명|회사명|날짜|내용)\]/g, (_m, key: string) => {
    const v = values[key as keyof typeof values];
    return v ?? "";
  });
}

/** 템플릿 검사 결과. 화면과 서버 액션이 **같은 규칙**을 쓰도록 여기 한 곳에 둔다. */
export type TemplateCheck = { ok: true } | { ok: false; error: string };

export function checkTemplate(name: string, body: string): TemplateCheck {
  const n = normalizeTemplateText(name).trim();
  const b = normalizeTemplateText(body).trim();
  if (!n) return { ok: false, error: "템플릿 이름을 입력해 주세요." };
  if (n.length > TEMPLATE_NAME_MAX) return { ok: false, error: `템플릿 이름은 ${TEMPLATE_NAME_MAX}자까지 쓸 수 있습니다.` };
  if (!b) return { ok: false, error: "문구를 입력해 주세요." };
  // 길이를 먼저 본다 — 아주 긴 글이 들어와도 글자를 두 번 훑지 않는다(검수 경미 4).
  const bytes = countSmsBytes(b);
  if (bytes > SMS_LONG_MAX_BYTES) return { ok: false, error: `문구가 너무 깁니다(${bytes}/${SMS_LONG_MAX_BYTES}바이트). 줄여 주세요.` };
  const bad = findUnsupportedPreview(b);
  if (bad.length) return { ok: false, error: `문자로 보낼 수 없는 글자가 있습니다: ${bad.join(" ")} (이모지는 쓸 수 없습니다)` };
  return { ok: true };
}
