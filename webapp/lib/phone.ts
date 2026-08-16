// 전화번호 정규화·표시·판정 (순수함수, 브라우저에서도 쓸 수 있게 외부 의존 없음).
//
// ⚠️ `normalizePhone`의 **원본이 여기다.** lib/sms.ts는 여기서 가져다 다시 내보낸다(기존 import 유지).
//    예전에는 sms.ts에 있었는데, sms.ts는 iconv-lite(Node 전용)를 쓰기 때문에 화면 코드가
//    전화번호 도우미를 쓰려고 sms.ts를 부르면 그 무거운 것이 브라우저 번들로 딸려온다.

/** 숫자만 남긴다(하이픈·공백·괄호 제거). */
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

/**
 * 국내 표기로 맞춘다 — `+82 10-1234-5678` → `01012345678`.
 *  · 왜 필요한가: 입력칸이 `autoComplete="tel"`이라 **브라우저 자동완성·연락처 앱 복사가
 *    국제표기(+82)로 채우는 일이 실제로 있다.** 그대로 두면 정상 번호인데 "휴대폰이 아니다"로
 *    거부돼, 사용자는 왜 막혔는지 모른다(검수 M-8).
 */
export function toLocalPhone(phone: string | null | undefined): string {
  const p = normalizePhone(phone);
  // 82로 시작하고 뒤가 0이 아니면 국가번호로 본다(예: 821012345678 → 01012345678).
  if (p.startsWith("82") && p.length >= 11 && p[2] !== "0") return "0" + p.slice(2);
  return p;
}

/**
 * 화면에 보여줄 가림 표시("010-****-5678").
 *  · 왜 가리나: 복구용 연락처가 어깨 너머로 전부 노출되면 안 된다. 본인이 "내 번호가 맞나"를
 *    확인하려면 앞 3자리·뒤 4자리면 충분하다.
 *  · ⚠️ **휴대폰 자릿수(10~11)가 아니면 그룹으로 나누지 않는다**(검수 경미 1).
 *    7자리 번호를 앞3+뒤4로 자르면 두 조각이 겹쳐 **번호 전체가 그대로 노출**된다.
 */
export function maskPhone(phone: string | null | undefined): string {
  const p = toLocalPhone(phone);
  // 휴대폰일 때만 "앞3-****-뒤4"로 나눈다. 그 형태는 휴대폰에서만 맞는 모양이다.
  if (isMobilePhone(p)) return `${p.slice(0, 3)}-****-${p.slice(-4)}`;
  // 그 외(유선·대표번호 등)는 **모양을 지어내지 않고** 뒤 4자리만 보여준다.
  //  · 앞자리를 3개로 끊으면 `02-1234-5678`이 `021-****-5678`처럼 **실제와 다른 번호로 보인다.**
  //  · 뒤 4자리만으로도 본인은 "내 번호가 맞나"를 알 수 있다.
  if (p.length >= 8) return `****-${p.slice(-4)}`;
  return "***";
}

/**
 * 문자를 **실제로 받을 수 있는** 휴대폰 번호인가.
 *
 * 🔴 왜 유선번호를 막나: 복구용 연락처로 `02-...`·`070-...`을 넣으면 인증번호 문자가 도착하지 않는다.
 *    그런데 아이원24는 응답 본문이 비면 성공으로 친다(lib/sms.ts interpretSmsResponse) → 시스템은
 *    "보냈다"고 기록하고 하루 발송 한도만 깎인다. 사용자는 영영 못 받고, 계정 존재 비노출 원칙 때문에
 *    **왜 안 오는지 알 방법도 없다.** 넣는 순간에 막는 것이 유일하게 친절한 지점이다.
 *  · 가상번호(050x)·유선(02,03x~06x,070)·대표번호(15xx,16xx,18xx)는 전부 거부된다.
 */
export function isMobilePhone(phone: string | null | undefined): boolean {
  const p = toLocalPhone(phone);
  return /^010\d{8}$/.test(p) || /^01[16789]\d{7,8}$/.test(p);
}
