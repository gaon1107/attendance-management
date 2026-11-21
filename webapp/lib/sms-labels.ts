// 문자 발송 기록(SmsLog)의 코드값 → 사람이 읽는 한글. **화면에서만** 쓰는 번역표다.
//  · 저장되는 값(kind·result)은 절대 바꾸지 않는다 — 발송 상한·1회 제한이 그 값을 기준으로 센다
//    (lib/sms.ts, lib/reset-code.ts, app/actions/account.ts). 여기서 바꾸면 조용히 상한이 풀린다.
//  · 새 종류를 추가하는 쪽(발송 코드)이 여기에도 한 줄 넣는다. 빠지면 화면에 코드값이 그대로 보인다.

/** SmsLog.kind → 한글 이름. 모르는 값은 그대로 보여 준다(새 종류가 생겨도 화면이 비지 않게). */
export function smsKindLabel(kind: string): string {
  switch (kind) {
    case "invite":
      return "직원 초대 링크";
    case "temp_password":
      return "임시 비밀번호";
    case "reset_code":
      return "비밀번호 찾기 인증번호";
    case "recovery_notice":
      return "복구 번호 변경 통지";
    case "phone_verify":
      return "복구 번호 확인";
    case "sms_test":
      return "연결 시험 문자";
    case "direct":
      // [메시지 발송]에서 관리자가 직접 보낸 문자(2026-11-22, 메시지 관리 3-2b).
      return "직접 보낸 문자";
    default:
      return kind;
  }
}

/** SmsLog.result → 한글. "unknown"은 **실패가 아니다**(보냈는지 알 수 없는 상태 — 요금이 나갔을 수도 있다). */
export function smsResultLabel(result: string): string {
  switch (result) {
    case "success":
      return "발송 성공";
    case "fail":
      return "실패";
    case "pending":
      return "보내는 중";
    case "unknown":
      return "결과 미확인";
    default:
      return result;
  }
}

/** 결과 배지 색(화면 공통). 키는 SmsLog.result 값. */
export const SMS_RESULT_STYLE: Record<string, { bg: string; dot: string; color: string }> = {
  success: { bg: "#DCFCE7", dot: "#15803D", color: "#15803D" },
  fail: { bg: "#FEE2E2", dot: "#B91C1C", color: "#B91C1C" },
  pending: { bg: "#E5E7EB", dot: "#6B7280", color: "#4B5563" },
  // 결과 미확인 = 요금이 나갔을 수도 있다 → 성공(초록)도 실패(빨강)도 아닌 주의색.
  unknown: { bg: "#FEF3C7", dot: "#B45309", color: "#B45309" },
};

/**
 * 어느 계정 요금으로 나갔는가(SmsLog.viaCompany).
 *  · true  = 그 회사가 [설정 → 문자·알림톡]에 연결한 비즈모아샷 계정 → **회사 요금**
 *  · false = 가온 계정(.env MOASHOT_*) → 회사 계정(회사 관리자) 인증 문자 전용 → 가온 요금
 *  2026-11-21 사장님 확정 요금 규칙이며, 화면 문구도 이 규칙과 같아야 한다.
 */
export function smsPayerLabel(viaCompany: boolean): string {
  return viaCompany ? "우리 회사" : "가온";
}
