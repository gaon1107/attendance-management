// "누구를 관리자로 바꿀 수 있나 / 누구를 퇴사시킬 수 있나" 규칙 한 곳.
//
// 왜 lib으로 뺐나
//  · 이 규칙이 틀리면 **회사가 통째로 잠기거나(관리자 0명), 아무나 관리자가 된다.** 가장 위험한 부분이라
//    화면·서버 액션에 흩어 두지 않고 한 곳에 모아 그대로 시험할 수 있게 한다(저장소 관례: 판정은 lib, 화면은 얇게).
//  · 서버 액션(app/actions/owner.ts·employees.ts)이 이 함수만 부른다 → 두 곳의 규칙이 어긋날 수 없다.
//
// 🔒 절대 규칙: **회사 계정(isOwner)은 강등·퇴사·삭제할 수 없다.**
//    관리자가 전원 퇴사해도 회사에 들어갈 수 있게 하는 마지막 열쇠이기 때문이다.

export type ActorLite = { id: string; role: string };
export type TargetLite = { id: string; role: string; isOwner: boolean; deactivatedAt: Date | null };

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
 * 관리자로 지정하거나 해제할 수 있는가.
 *  · 퇴사자는 대상이 아니다(복직시킨 뒤에 지정한다).
 *  · 이미 그 상태면 바꿀 것이 없다(쓰기를 하지 않는다).
 */
export function canChangeRole(me: ActorLite, target: TargetLite | null, makeAdmin: boolean): RuleResult {
  const blocked = commonGuard(me, target);
  if (blocked) return blocked;
  const t = target as TargetLite;

  if (t.deactivatedAt) return { ok: false, reason: "퇴사한 직원은 권한을 바꿀 수 없습니다." };
  if (t.role === (makeAdmin ? "admin" : "employee")) return { ok: false, reason: "이미 같은 권한입니다." };
  return { ok: true, target: t };
}

/**
 * 퇴사(비활성화) 처리할 수 있는가.
 *  · 2026-07-27 이전에는 **관리자 전원**을 막았다. 그래서 관리자가 실제로 퇴사해도 계정을 정리할 수 없었다.
 *    이제 관리자도 퇴사시킬 수 있다 — 회사 계정이 남아 있어 회사가 잠기지 않기 때문이다.
 */
export function canDeactivate(me: ActorLite, target: TargetLite | null): RuleResult {
  const blocked = commonGuard(me, target);
  if (blocked) return blocked;
  const t = target as TargetLite;
  if (t.deactivatedAt) return { ok: false, reason: "이미 퇴사 처리된 직원입니다." };
  return { ok: true, target: t };
}
