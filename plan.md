# Plan: 결재선 2차 — 전결(전결권자 지정) (2026-07-20) — 상태: 검토 대기

> 확정: **B. 전결권자 지정** + **휴가·근태정정 둘 다**. 작업 위치 = 메인 저장소 master.

## 1. 접근 방식 (+이유)
- **핵심 = 체인 조기 종결(truncation)**. 관리자가 부서에 "전결권자"를 지정하면, `buildApprovalChain`이 그 부서장을 결재자로 추가하는 순간 **상위 탐색을 멈춘다**. 그 사람이 마지막 단계가 되어, 기존 `isChainComplete`가 그의 승인을 자동으로 "완료"로 판정한다.
  → **`advanceApproval`(승인/반려/멱등복구) 골격을 전혀 손대지 않는다** = 가장 안전. 전결은 "체인이 더 짧게 생성된다"로 환원된다.
- 왜 이 방식: 관리자 오버라이드처럼 "남은 단계 skip" 특수분기를 추가하면 advanceApproval이 복잡해지고 회귀면이 넓어진다. 조기 종결은 **생성 시점에 체인을 확정**(기존 철학)하고 진행 로직은 불변으로 둔다.
- 전결권자가 신청자 본인이면 자기결재 방지로 추가 안 됨 → 종결 안 하고 상위로 계속(엣지 자연 처리).

## 2. 수정/생성 파일 목록
1. `webapp/prisma/schema.prisma` — `Department.finalApproval`, `ApprovalStep.isFinal` (둘 다 Boolean @default(false), add-only) + 마이그레이션 1건.
2. `webapp/lib/approval.ts` — `DeptNode`에 finalApproval, `buildApprovalChain` 조기종결 + 반환 타입(`approvers: {userId, isFinal}[]`).
3. `webapp/lib/approval-server.ts` — `resolveApproverChain` 반환 반영, `createApprovalStepsIfNeeded`에서 isFinal 저장, `getApprovalProgressMap`에 전결 여부 노출(표시용).
4. `webapp/app/actions/departments.ts` — `saveDepartmentApproval`에 finalApproval 저장(체크박스).
5. `webapp/app/employees/DepartmentManager.tsx` — `DeptApprovalRow`에 전결권자 체크박스 + "현재 저장" 전결 표시. `Dept` 타입에 finalApproval.
6. `webapp/app/employees/page.tsx` — `deptData` map에 finalApproval 추가.
7. (표시·경량) 진행표시에 "전결" 배지: `getApprovalProgressMap` 결과에 `finalApplied` 추가 → 소비처 표시. **최소 범위로.**

## 3. 🛡️ 사이드 이펙트 방어
- **영향받을 수 있는 기능 + 대응**
  - single 회사(결재선 미사용): approvalMode!=="deptline" → createApprovalStepsIfNeeded 조기반환. 전결 코드 미진입 → **완전 무영향**.
  - 기존 deptline 회사(전결권자 미지정): finalApproval 전부 false → 조기종결 안 함 → **체인·동작 동일 = 회귀 0**.
  - advanceApproval/원본 status 소비처 9곳: 전결로 체인이 짧아져도 "완료 시 approved" 원칙 그대로 → **무영향**.
  - 반환 타입 변경: 호출처 `resolveApproverChain`·`createApprovalStepsIfNeeded`(내부 2곳)만 동시 수정 → 컴파일러가 누락 잡음.
- **구현 후 반드시 테스트할 기존 기능 목록**
  1. single 회사 휴가·근태정정 승인/반려(기존 경로)
  2. deptline·전결권자 미지정 2단계 결재선(신청→1차→2차 승인) 정상 완료
  3. 전결권자 지정 시 체인이 그 단계에서 종결(승인=최종 approved)
  4. 전결권자=신청자 본인일 때 상위로 계속(자기결재 방지)
  5. 전결 단계 반려 → 원본 반려 확정
  6. `tsc`·`eslint` 0

## 4. 작업분해 TODO
- [ ] 1단계: schema에 `Department.finalApproval`·`ApprovalStep.isFinal` 추가 + `prisma migrate dev --name approval_final` — 파일: `schema.prisma`
- [ ] 2단계: `lib/approval.ts` — DeptNode.finalApproval, buildApprovalChain 조기종결, 반환 `approvers:{userId,isFinal}[]`
- [ ] 3단계: `lib/approval-server.ts` — resolveApproverChain 반영, createApprovalStepsIfNeeded에서 isFinal 저장
- [ ] 4단계: `departments.ts` saveDepartmentApproval에 finalApproval 저장 + `employees/page.tsx` deptData·`DepartmentManager.tsx` 체크박스/표시
- [ ] 5단계: (경량) getApprovalProgressMap 전결 표시 + 소비처 배지 최소 반영
- [ ] 6단계: tsc·eslint 0
- [ ] 7단계: 실DB 롤백검증(무커밋) — 위 3.테스트 1~5 시나리오(체인 산출·조기종결·자기결재·반려)
- [ ] 8단계: 영향받는 기존 기능 회귀 테스트(single·deptline 미지정)
- [ ] 9단계: 검수(code-reviewer) + project-status.md 갱신 + git 커밋

## 5. 핵심 로직 샘플 (계획용 스니펫, 실제 구현 아님)
```ts
// approval.ts
export type DeptNode = { id: string; headUserId: string | null; parentId: string | null; deputyUserId: string | null; finalApproval: boolean };
export type ChainApprover = { userId: string; isFinal: boolean };
export type ApprovalChain = { approvers: ChainApprover[]; adminFallback: boolean };

// buildApprovalChain 내부 while 루프:
const candidate = node.headUserId ?? node.deputyUserId ?? null;
if (candidate && !seen.has(candidate)) {
  const isFinal = node.finalApproval === true;
  approvers.push({ userId: candidate, isFinal });
  seen.add(candidate);
  if (isFinal) break; // 전결권자 → 상위로 안 올라가고 종결
}
deptId = node.parentId;
// return { approvers, adminFallback: approvers.length === 0 };
```
```ts
// approval-server.ts createApprovalStepsIfNeeded
const chain = await resolveApproverChain(...); // ChainApprover[]
if (chain.length === 0) return;
await prisma.approvalStep.createMany({
  data: chain.map((a, i) => ({ companyId, requestType, requestId, stepOrder: i + 1, approverUserId: a.userId, isFinal: a.isFinal })),
});
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- 조건별 결재선(금액/일수 규칙)·자동 에스컬레이션 — 별도 조각(이번 범위 아님).
- 전결권 다단계(여러 전결권자 중 특정 조합) — MVP는 "가장 낮은 전결권자에서 종결" 단순 규칙.
- advanceApproval에 전결 특수분기 추가 — 조기종결로 환원되어 불필요(안전).
- 화려한 전결 이력 타임라인 — 표시는 최소 배지로.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
