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
// 🔴 켜기 전에 반드시 확인할 것:
//    · .env에 IONE_SMS_* 설정(문자가 실제로 나가야 한다)
//    · 회사 계정들의 복구용 연락처가 **문자 받을 수 있는 휴대폰**으로 등록돼 있는지
//    · 번호 변경 직후 복구 잠금(User.phoneChangedAt 활용) 도입 여부 검토 — 공격자가 미리 번호를
//      심어두고 개방일에 수확하는 것을 막는 표준 방어다.
//    · **대시보드·온보딩에 "복구용 연락처를 등록하세요" 안내를 노출**한다(검수 추가 권고).
//      지금은 [계정 설정]에 들어가야만 이 카드가 보이는데, 회사 계정은 평소 로그인하지 않는 계정이라
//      개방일이 와도 아무도 번호를 넣어두지 않은 상태가 된다 — 그러면 기능이 있어도 무용지물이다.
//    · 🔴 **등록된 번호가 진짜 받을 수 있는 번호인지 확인하는 절차가 아직 없다**(재검수 중간 4).
//      지금은 "010 형식인가"만 본다 — `010-0000-0000`도 통과하고, 오타 없이 정확히 입력한
//      **남의 번호·해지된 번호**도 그대로 저장된다. 저장 전 확인 화면은 "내가 친 글자가 이건가"만
//      보여줄 뿐이다. 열기 전에 **새 번호로 인증코드를 보내 소유를 확인**하는 단계를 넣어야 한다
//      (lib/reset-code.ts에 코드 발급·검증·1분 슬롯·시도 상한이 이미 다 있다).
//    · 🔴 **세션 정책(lib/session.ts)을 함께 재검토**한다. 거기 15~21행이 "회사 계정은 복구 수단이
//      0이라 유휴 만료 대상에서 뺀다"고 적어 두었는데, 이 스위치를 켜는 순간 그 전제가 바뀐다.
//      스위치만 켜고 session.ts를 그대로 두면, 로드맵 ④(세션 조이기)가 영영 잊힌다.
import { toLocalPhone, isMobilePhone } from "@/lib/phone";

export const OWNER_RECOVERY_ENABLED = false;

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
