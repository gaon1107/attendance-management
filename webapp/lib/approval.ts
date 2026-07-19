// 결재선(부서장 자동 결재선) 순수 계산 — 결재자 배열 산출·단계 진행 판정.
//  · DB·화면 접근 없음(순수함수) → 임시 라우트/스크립트로 경계값 검증한다.
//  · 설계: docs/04_architecture/결재선_설계.md
//  · 원칙: 원본 신청 status는 전 단계 승인 시에만 approved. 그전엔 pending(=미승인, 소비처 9곳 회귀 0).

// 결재선 계산에 필요한 부서 정보(관계 없이 id만 보관하는 add-only 스키마 반영).
export type DeptNode = {
  id: string;
  headUserId: string | null;   // 부서장(1차 결재자 후보)
  parentId: string | null;     // 상위부서 id(위로 타고 올라감). null=최상위
  deputyUserId: string | null; // 대결자(부서장 없을 때 대체)
};

export type ApprovalChain = {
  approverUserIds: string[]; // 순서대로 결재자(중복·본인 제외)
  adminFallback: boolean;    // 결재자를 한 명도 못 뽑음 → 관리자 단일 승인으로 폴백
};

// 신청자의 부서에서 시작해 상위부서로 올라가며 최대 stepCount명의 결재자를 모은다.
//  · 각 부서 결재자 = headUserId 우선, 없으면 deputyUserId. 둘 다 없으면 그 부서는 건너뛰고 계속 상위로.
//  · 신청자 본인은 결재자에서 제외(자기결재 방지) → 부서장이 신청하면 그 단계는 건너뛰고 상위부서장이 결재.
//  · 이미 뽑힌 결재자는 중복 제외.
//  · 방어: 부서 계층 순환(A→B→A)·누락(deptMap에 없음)이면 그 지점에서 중단. stepCount는 0~3으로 클램프.
export function buildApprovalChain(
  applicantUserId: string,
  applicantDeptId: string | null,
  deptMap: Map<string, DeptNode>,
  stepCount: number,
): ApprovalChain {
  const approverUserIds: string[] = [];
  const seen = new Set<string>([applicantUserId]); // 본인은 처음부터 제외 대상
  const visitedDepts = new Set<string>();
  const maxSteps = Math.max(0, Math.min(Math.trunc(stepCount), 3)); // 방어: 0~3단계

  let deptId: string | null = applicantDeptId;
  while (deptId && approverUserIds.length < maxSteps) {
    if (visitedDepts.has(deptId)) break; // 순환 차단
    visitedDepts.add(deptId);
    const node = deptMap.get(deptId);
    if (!node) break; // 부서 정보 누락 → 중단
    const candidate = node.headUserId ?? node.deputyUserId ?? null;
    if (candidate && !seen.has(candidate)) {
      approverUserIds.push(candidate);
      seen.add(candidate);
    }
    deptId = node.parentId;
  }

  return { approverUserIds, adminFallback: approverUserIds.length === 0 };
}

// ── 단계 진행 판정용(Phase 3에서 사용). status: pending|approved|rejected|skipped ──
export type StepLike = { stepOrder: number; status: string };

// 다음 처리할 단계 = 가장 낮은 stepOrder의 pending. 없으면 null.
export function nextPendingStep<T extends StepLike>(steps: T[]): T | null {
  let best: T | null = null;
  for (const s of steps) {
    if (s.status !== "pending") continue;
    if (best === null || s.stepOrder < best.stepOrder) best = s;
  }
  return best;
}

// 전원 승인 완료 = 단계가 하나 이상 있고 모두 approved/skipped(본인 건너뜀 포함).
export function isChainComplete(steps: StepLike[]): boolean {
  if (steps.length === 0) return false;
  return steps.every((s) => s.status === "approved" || s.status === "skipped");
}

// 반려 = 한 단계라도 rejected.
export function isChainRejected(steps: StepLike[]): boolean {
  return steps.some((s) => s.status === "rejected");
}
