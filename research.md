# Research: 결재선 2차 — 전결(전결권자 지정) (2026-07-20)

> 범위(사장님 확정): **B. 전결권자 지정 방식** + **휴가·근태정정 둘 다**. 조건별·자동에스컬레이션은 이번 범위 제외(별도 조각).
> 작업 위치: **메인 저장소 master**(직전 교대 정리와 동일 라인).

## 전결이란(이 시스템에서의 정의)
- 결재선은 **신청자 부서장(1단계) → 상위 부서장(2단계) → …** 순으로 아래→위로 올라간다(`buildApprovalChain`).
- **전결권자** = 관리자가 부서에 "이 부서장은 전결권자"라고 미리 지정한 사람. 결재선이 그 사람까지 오면 **그 사람의 승인이 최종** — 상위로 올라가지 않고 종결.
- 한국 전결규정에 충실: 전결권자는 보통 낮은 단계(직속 부서장)라, 그 선에서 끝내 상위를 거치지 않게 한다.

## 관련 파일과 역할
- `webapp/lib/approval.ts` — 순수함수. `buildApprovalChain`(결재자 배열 산출), `DeptNode`, `ApprovalChain`, `nextPendingStep`/`isChainComplete`/`isChainRejected`. **핵심 수정 대상.**
- `webapp/lib/approval-server.ts` — DB 로직. `resolveApproverChain`(부서 조회→buildApprovalChain), `createApprovalStepsIfNeeded`(ApprovalStep 생성), `advanceApproval`(단계 진행), `getApprovalProgressMap`/`listMyApprovals`(표시). **수정 대상.**
- `webapp/app/actions/departments.ts` — `saveDepartmentApproval`(부서장·상위부서·대결자 저장). **전결권자 저장 추가 지점.**
- `webapp/app/employees/DepartmentManager.tsx` — 부서 결재설정 폼(`DeptApprovalRow`). **전결권자 체크박스 UI 추가 지점.**
- `webapp/app/employees/page.tsx` — 부서 데이터 로드(`department.findMany`는 select 없이 전체 → finalApproval 자동 포함). `deptData` map에 필드 추가만.
- `webapp/prisma/schema.prisma` — `Department`(336), `ApprovalStep`(317). **add-only 필드 추가.**
- 진행표시 소비처: `leave/page.tsx`, `leave/approvals/page.tsx`, `corrections/page.tsx`, `corrections/approvals/page.tsx`(모두 `getApprovalProgressMap` 사용). 결재함 `app/approvals/page.tsx`(`listMyApprovals`).

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳) — 전수 추적 결과
- `buildApprovalChain` 호출처: **`resolveApproverChain` 1곳뿐**(lib/approval-server.ts:24, `.approverUserIds` 참조).
- `resolveApproverChain` 호출처: **`createApprovalStepsIfNeeded` 1곳뿐**(내부).
- `createApprovalStepsIfNeeded` 호출처: `leave.ts:66`, `corrections.ts:44` — **둘 다 인자 무변경**(전결은 체인 내부에서 처리되므로 이 두 액션은 손대지 않음).
- ⇒ 체인 반환 타입을 바꿔도 **lib/approval.ts + lib/approval-server.ts 안에서만** 파급. 신청 생성 경로 무변경 = 회귀 위험 낮음.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- `buildApprovalChain`은 순수함수지만 호출처가 1개라 사실상 격리됨 → safe-coding 관점에서도 저위험.
- **건드리면 안 됨**: `advanceApproval`의 승인/반려/멱등복구 로직 골격(전결은 "체인이 전결권자에서 끝난다"로 자연 처리되므로 advanceApproval 특수분기 불필요), 원본 status는 체인 완료 시에만 approved(원칙 A, 소비처 9곳 회귀 0).

## DB·API 변경 여부, 위험 요소
- **schema add-only 2필드**(둘 다 `@default(false)` → 기존 행 자동 false = 무영향):
  - `Department.finalApproval Boolean @default(false)` — 전결권자 지정.
  - `ApprovalStep.isFinal Boolean @default(false)` — 이 단계가 전결 종결 단계인지(표시·감사용).
- 마이그레이션 1건 추가(migrate dev). 기존 deptline 회사: finalApproval 전부 false → `buildApprovalChain`이 조기 종결 안 함 → **체인 동일 = 회귀 0**.
- 동시성: 기존 트랜잭션·멱등 구조 유지. N+1 없음.
- 테넌트 격리: departments 조회·저장 모두 companyId 스코프(기존 유지).

## 결론 (계획 시 고려사항)
1. **핵심 메커니즘 = 체인 조기 종결(truncation)**: `buildApprovalChain`이 전결권자를 결재자로 추가하면 그 지점에서 상위 탐색을 멈춘다. 그 사람이 마지막 단계가 되어, 기존 `isChainComplete`가 그의 승인을 완료로 판정 → **advanceApproval 특수 분기 불필요**(가장 안전).
2. 전결권자가 **신청자 본인**이면 자기결재 방지로 추가 안 됨 → 종결 안 하고 상위로 계속(엣지 자연 처리). "실제로 전결권자를 추가했을 때만 종결"이 핵심.
3. `ApprovalStep.isFinal`은 생성 시 마지막(전결) 단계에만 true → "전결" 배지·감사표시용. 없어도 동작은 되지만, 조기종결 체인과 일반 1단계 체인을 구분하려면 필요.
4. 표시(전결 배지)는 소비처가 많아 **핵심 동작 우선, 표시는 최소**로. 관리자 설정(전결권자 지정·현재저장 표시)은 필수, 신청자/결재함 배지는 경량 추가.
5. 반환 타입 변경(`approverUserIds: string[]` → `approvers: {userId, isFinal}[]`)은 호출처 2곳(내부)만 손보면 됨.
