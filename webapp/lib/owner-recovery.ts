// 회사 계정(마스터 열쇠) 복구 기능의 **단일 스위치**.
//
// 🔴 왜 이 파일이 따로 있나 — 이걸 안 만들었다가 잡힌 사고(검수 치명 2)
//    처음에는 화면이 "문자 발송이 설정됐는가(smsConfigured)"로 복구 가능 여부를 표시했다.
//    그런데 그 둘은 **아무 관계가 없다.** 문자 설정은 초대·임시비번 발송에도 쓰이므로,
//    다른 이유로 .env를 채우는 순간 화면의 "아직 복구 안 됩니다" 경고가 사라진다.
//    비개발자인 사장님은 "이제 회사 계정도 되찾을 수 있다"고 이해하고, 실제로는 아직 막혀 있어
//    비밀번호를 잊는 순간 **회사가 영구히 잠긴다.** 이 제품에서 가장 비싼 오해다.
//
// ✅ 켜는 방법 — **이 파일의 값 하나만 바꾸면 된다.**
//    lib/reset-code.ts가 이 상수를 직접 읽으므로(ownerBlocked), 화면 경고와 실제 복구 가능 여부가
//    구조적으로 함께 움직인다. 예전엔 "두 곳을 같이 고쳐라"를 주석으로만 부탁해서, 하나만 고치면
//    **경고는 사라졌는데 복구는 안 되는** 최악의 상태가 됐다(검수 N-5).
//
// ⚠️ 단, [비밀번호 찾기]의 **관리자 승인 경로**(app/actions/password-reset.ts)는 이 스위치와 무관하게
//    회사 계정을 **영구히** 막는다. 그 경로는 관리자가 승인해 임시비번을 발급하는 구조라,
//    열어주면 관리자가 직원 요청인 줄 알고 승인해 **회사 열쇠를 그대로 넘겨준다**(검수 치명 1).
//
// ✅ 2026-11-21 켰다 — 켜기 전 점검 목록과 처리 결과(사장님 승인 "진행"):
//    · 번호 변경 직후 복구 잠금 → 72시간(OWNER_RECOVERY_LOCK_MS, 아래 ownerRecoveryState)
//    · 번호 소유 확인 → [계정 설정]에서 그 번호로 인증번호를 받아 확인(lib/phone-verify.ts).
//      **확인하지 않은 번호로는 복구가 열리지 않는다** — 가입 때 적은 번호도 한 번은 확인해야 한다.
//    · 대시보드 안내 → 번호 미확인이면 관리자 대시보드 상단에 노출(app/dashboard/page.tsx)
//    · 몰래 되찾았을 때 탐지 → 알림센터 7일 경고(lib/notifications.ts)
//    · 문자 전체 발송 상한(보안검수 M7) → lib/sms.ts
//    · ⚠️ **가온 문자 계정(MOASHOT_*)이 없으면 여전히 아무도 되찾을 수 없다.** 번호 확인도 문자로 하기 때문이다.
//      스위치가 켜져 있어도 운영 서버에 문자 계정을 넣기 전까지는 사실상 닫혀 있다(화면도 그렇게 말한다).
//    · ✅ 세션 정책 조이기(로드맵 ④) — 2026-11-23 완료(lib/session.ts 머리말). 회사 계정도 7일·12시간 미사용·창 닫으면 로그아웃.
//      ⚠️ 그래서 이 스위치를 끄면(false) 회사 계정은 자주 로그인해야 하는데 잊었을 때 되찾을 길이 0이 된다 —
//         끌 일이 생기면 session.ts의 isTightPolicy에서 회사 계정을 함께 빼야 한다.
//    · 끄려면 아래 값을 false로 — 막는 곳·화면이 함께 닫힌다(번호 확인 기록은 남는다).
import { toLocalPhone, isMobilePhone } from "@/lib/phone";

export const OWNER_RECOVERY_ENABLED = true;

// ═══════════════════════════════════════════════════════════════════════════
// 회사 계정이 **지금** 문자로 비밀번호를 되찾을 수 있는가 — 판정은 이 함수 하나에서만 한다.
//  · lib/reset-code.ts(실제로 막는 곳)와 [계정 설정]·대시보드·알림센터(보여주는 곳)가 같은 함수를 쓴다.
//    두 곳이 따로 판단하면 "화면은 된다는데 실제로는 안 되는" 어긋남이 생긴다(이 파일 머리말의 사고).
//
// 🔴 2026-08-12에 한 번 열었다가 되돌린 이유 = "회수할 수 없는 뒷문"
//    가입한 담당자의 폰 번호가 그대로 복구 번호가 되는데, 그 사람이 나가도 회사가 막을 길이 없었다.
//    그래서 열기 전에 아래 세 가지를 붙였다(2026-11-21).
//   ① **번호 확인** — 그 번호로 인증번호를 받아 입력해야 "확인됨". 확인한 번호와 지금 번호가 다르면 무효.
//      (가입 때 적은 번호·오타·해지된 번호로는 복구가 열리지 않는다)
//   ② **번호를 바꾸면 72시간 잠금** — 세션을 훔친 사람이 자기 번호를 심고 곧바로 비밀번호를 빼가는 것을 막는다.
//      그 사이 옛 번호로 "연락처가 바뀌었다"는 문자가 가고(actions/account.ts), 원래 담당자가 되돌릴 시간이 된다.
//   ③ **회사 계정 비밀번호가 문자로 바뀌면 알림센터에 경고** — 관리자들이 7일 동안 본다(lib/notifications.ts).
// ═══════════════════════════════════════════════════════════════════════════

/** 복구 번호를 바꾼 뒤 문자 복구를 잠가 두는 시간. */
export const OWNER_RECOVERY_LOCK_MS = 72 * 60 * 60 * 1000;

export type OwnerRecoveryFields = {
  phone: string | null;
  phoneChangedAt: Date | null;
  phoneVerifiedAt: Date | null;
  phoneVerifiedNumber: string | null;
};

export type OwnerRecoveryState =
  | { ready: true }
  | { ready: false; reason: "disabled" | "no_phone" | "not_mobile" | "not_verified" }
  | { ready: false; reason: "locked"; unlockAt: Date };

/** 확인된 번호인가 — 확인한 번호가 지금 번호와 같고, 마지막 변경 이후에 확인했어야 한다. */
export function phoneIsVerified(u: OwnerRecoveryFields): boolean {
  if (!u.phoneVerifiedAt || !u.phoneVerifiedNumber) return false;
  if (toLocalPhone(u.phoneVerifiedNumber) !== toLocalPhone(u.phone)) return false;
  // 번호를 바꾸는 창구가 확인 상태를 지우는 것을 잊어도, 바꾼 시각이 확인보다 뒤면 무효로 본다.
  if (u.phoneChangedAt && u.phoneVerifiedAt.getTime() < u.phoneChangedAt.getTime()) return false;
  return true;
}

export function ownerRecoveryState(u: OwnerRecoveryFields, now: Date = new Date()): OwnerRecoveryState {
  if (!OWNER_RECOVERY_ENABLED) return { ready: false, reason: "disabled" };
  if (!toLocalPhone(u.phone)) return { ready: false, reason: "no_phone" };
  if (!isMobilePhone(u.phone)) return { ready: false, reason: "not_mobile" };
  if (!phoneIsVerified(u)) return { ready: false, reason: "not_verified" };
  if (u.phoneChangedAt) {
    // 바꾼 시각이 미래(서버 시계 되감김)여도 잠금으로 본다 — 의심스러우면 닫는 쪽.
    const unlockAt = new Date(u.phoneChangedAt.getTime() + OWNER_RECOVERY_LOCK_MS);
    if (now.getTime() < unlockAt.getTime()) return { ready: false, reason: "locked", unlockAt };
  }
  return { ready: true };
}
