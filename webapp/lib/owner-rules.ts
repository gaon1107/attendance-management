// "누구를 관리자로 바꿀 수 있나 / 누구를 퇴사시킬 수 있나 / 누구 계정을 손댈 수 있나" 규칙 한 곳.
//
// 왜 lib으로 뺐나
//  · 이 규칙이 틀리면 **회사가 통째로 잠기거나(관리자 0명), 남이 회사 계정을 빼앗는다.** 가장 위험한 부분이라
//    화면·서버 액션에 흩어 두지 않고 한 곳에 모아 그대로 시험할 수 있게 한다(저장소 관례: 판정은 lib, 화면은 얇게).
//  · 서버 액션(app/actions/owner.ts·employees.ts·password-reset.ts)이 이 함수만 부른다 → 규칙이 어긋날 수 없다.
//
// 🔒 절대 규칙 두 가지
//  ① **회사 계정(isOwner)은 강등·퇴사·삭제할 수 없고, 계정 정보(비밀번호·이름 등)도 남이 손댈 수 없다.**
//     ⚠️ 검수 치명 1: 처음에는 강등·퇴사만 막았는데, [비밀번호 재설정]·[임시 비번 발급]에는 검사가 없어
//     **관리자로 지정된 직원이 회사 계정의 비밀번호를 바꿔 열쇠를 통째로 빼앗을 수 있었다.**
//     그래서 "계정을 손대는 모든 경로"가 canManageAccount를 지나가게 했다.
//  ② **이 변경으로 회사에 사람 관리자가 0명이 되면 안 된다.**
//     ⚠️ 검수 치명 2: 관리자 두 명이 서로를 동시에 해제·퇴사시키면 0명이 될 수 있었다.
//     ⚠️ 2차 검수: 처음에는 "회사 계정이 있으면 0명이어도 된다"고 봤는데, **회사 계정 비밀번호를 잃으면
//     되찾을 방법이 없다**(자동 메일 발송이 없어 비번찾기가 관리자 승인식이다). 열쇠가 있어도 못 쓰는 상태를
//     "안전하다"고 보면 회사가 영구히 잠긴다. 그래서 **회사 계정 유무와 무관하게 마지막 관리자를 지킨다.**
//     (가입 직후 사람 관리자가 0명인 것은 정상 — 이 검사는 관리자를 줄일 때만 작동한다.)

export type ActorLite = { id: string; role: string };
export type TargetLite = { id: string; role: string; isOwner: boolean; deactivatedAt: Date | null };

/**
 * 회사의 현재 상태 — 관리자 0명이 되는 것을 막기 위해 호출 측이 세어 넘긴다.
 *  · `otherActiveAdmins`: 대상(target)을 뺀, 재직 중이며 회사 계정이 아닌 **사람 관리자** 수
 */
export type CompanyState = { otherActiveAdmins: number };

/**
 * 통과하면 `target`을 함께 돌려준다.
 *  · 왜 이렇게: 호출 측이 `rule.target.id`를 쓰면 "검사를 통과한 대상"만 고칠 수 있다.
 *    검사를 건너뛰고 다른 대상을 고치는 실수가 타입 단계에서 막힌다.
 */
export type RuleResult =
  | { ok: false; reason: string }
  | { ok: true; target: TargetLite };

/** 공통 검사 — 관리자만, 그리고 회사 계정·본인은 대상이 아니다. 통과하면 null. */
function commonGuard(me: ActorLite, target: TargetLite | null): { ok: false; reason: string } | null {
  if (me.role !== "admin") return { ok: false, reason: "권한이 없습니다." };
  if (!target) return { ok: false, reason: "대상을 찾을 수 없습니다." };
  if (target.isOwner) return { ok: false, reason: "회사 계정은 변경할 수 없습니다." };
  if (target.id === me.id) return { ok: false, reason: "본인은 변경할 수 없습니다." };
  return null; // 통과
}

/**
 * 🔒 이 사람의 **계정 자체**(비밀번호·이름·인적정보·근무요일 등)를 손댈 수 있는가.
 *  · 회사 계정에 대해서는 언제나 거부한다. 비밀번호를 바꿔치기하면 회사 열쇠를 빼앗는 것과 같기 때문이다.
 *  · 본인 계정은 여기서 막지 않는다 — 자기 비밀번호를 바꾸는 것은 정상 동작이다(개별 액션이 판단).
 */
export function canManageAccount(me: ActorLite, target: { isOwner: boolean } | null): RuleResult2 {
  if (me.role !== "admin") return { ok: false, reason: "권한이 없습니다." };
  if (!target) return { ok: false, reason: "대상을 찾을 수 없습니다." };
  if (target.isOwner) {
    return { ok: false, reason: "회사 계정은 다른 사람이 변경할 수 없습니다. 회사 계정으로 직접 로그인해 바꿔주세요." };
  }
  return { ok: true };
}

/** canManageAccount 전용 결과(대상 타입이 더 느슨해 target을 돌려주지 않는다). */
export type RuleResult2 = { ok: false; reason: string } | { ok: true };

/**
 * 관리자로 지정하거나 해제할 수 있는가.
 *  · 퇴사자는 대상이 아니다(복직시킨 뒤에 지정한다).
 *  · 이미 그 상태면 바꿀 것이 없다(쓰기를 하지 않는다).
 *  · **관리자를 해제할 때** 회사에 관리자가 남지 않으면 거부한다(회사 계정이 없는 회사 한정).
 */
export function canChangeRole(
  me: ActorLite,
  target: TargetLite | null,
  makeAdmin: boolean,
  company: CompanyState
): RuleResult {
  const blocked = commonGuard(me, target);
  if (blocked) return blocked;
  const t = target as TargetLite;

  if (t.deactivatedAt) return { ok: false, reason: "퇴사한 직원은 권한을 바꿀 수 없습니다." };
  if (t.role === (makeAdmin ? "admin" : "employee")) return { ok: false, reason: "이미 같은 권한입니다." };

  if (!makeAdmin) {
    const left = lastAdminGuard(t, company);
    if (left) return left;
  }
  return { ok: true, target: t };
}

/**
 * 퇴사(비활성화) 처리할 수 있는가.
 *  · 2026-07-27 이전에는 **관리자 전원**을 막았다. 그래서 관리자가 실제로 퇴사해도 계정을 정리할 수 없었다.
 *    이제 관리자도 퇴사시킬 수 있다 — 단, 그 결과로 회사에 관리자가 0명이 되면 안 된다.
 */
export function canDeactivate(me: ActorLite, target: TargetLite | null, company: CompanyState): RuleResult {
  const blocked = commonGuard(me, target);
  if (blocked) return blocked;
  const t = target as TargetLite;
  if (t.deactivatedAt) return { ok: false, reason: "이미 퇴사 처리된 직원입니다." };

  const left = lastAdminGuard(t, company);
  if (left) return left;
  return { ok: true, target: t };
}

/**
 * 🔴 마지막 관리자 보호 — 이 변경으로 회사에 관리자가 0명이 되는가.
 *  · 회사 계정이 있으면 허용한다(회사 계정으로 들어가 새 관리자를 지정할 수 있다).
 *  · 회사 계정이 없는 회사(2026-07-27 개편 이전에 가입한 회사)는 마지막 관리자를 반드시 지킨다.
 */
function lastAdminGuard(t: TargetLite, company: CompanyState): { ok: false; reason: string } | null {
  if (t.role !== "admin") return null;            // 대상이 관리자가 아니면 관리자 수가 줄지 않는다
  if (company.otherActiveAdmins > 0) return null; // 다른 사람 관리자가 남는다
  return {
    ok: false,
    reason: "이 회사의 마지막 관리자입니다. 다른 직원을 먼저 관리자로 지정한 뒤에 진행해주세요.",
  };
}
