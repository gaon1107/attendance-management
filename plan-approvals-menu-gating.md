# Plan: [결재함] 메뉴를 결재 라인에 있는 사람만 보이게 (2026-07-20) — 상태: 검토 대기

## 1. 접근 방식
- 지금: `Sidebar`의 `groupsFor`가 deptline 회사면 admin·employee **모두**에게 "approvals"(결재함) 메뉴를 추가.
- 바꿈: [결재함]은 **결재 라인 구성원**에게만. 판정 = ①부서장(Department.headUserId) 또는 대결자(deputyUserId)로 지정됨 **OR** ②지금 결재 대기(pending step) 있음.
  - ②를 OR로 넣는 이유: 지정에서 빠진 직후라도 이미 걸린 진행 중 결재는 처리할 수 있게(놓침 방지).
  - 전결권자(finalApproval 부서장)는 headUserId라 ①에 자동 포함.
- **관리자도 동일 규칙 적용**: 관리자의 [결재함](/approvals)은 "내가 결재자로 지정된 건"만 보여주므로, 지정 안 됐으면 어차피 빈 화면. 관리자의 승인·오버라이드는 기존 [휴가승인]·[근태정정승인] 화면에서 그대로 → 무영향.

## 2. 수정 파일 (2개, 표시 로직만)
1. `webapp/lib/approval-server.ts` — 신규 `isApprovalLineMember(companyId, userId): Promise<boolean>` (Department에 head/deputy로 지정됐는지 count>0, React `cache()`로 요청 내 1회).
2. `webapp/app/components/Sidebar.tsx` — `showApprovals = deptline && (approvalWaiting>0 || await isApprovalLineMember(...))` 계산 → `groupsFor(role, showApprovals)`가 그 값일 때만 "approvals" 포함.

## 3. 🛡️ 사이드 이펙트 방어
- `groupsFor` 시그니처 변경(deptline → showApprovals): 호출처 **Sidebar 1곳뿐**(내부) → 컴파일러가 잡음.
- `/approvals` 페이지 자체는 **무변경**: 메뉴가 없어도 직접 주소로 들어가면 `listMyApprovals`가 "내 차례"만 반환 → 결재자 아니면 "결재할 항목이 없습니다"(기존과 동일, 보안 노출 0).
- single 회사: 지금도 메뉴 없음 → 완전 무영향(추가 쿼리도 deptline일 때만).
- 배지(approvalWaiting) 로직 무변경.
- 성능: deptline 회사에서 사이드바당 count 쿼리 1개 추가(cache로 요청 내 1회). 경량.
- 테스트할 것: ①부서장 계정 → 메뉴 보임 ②대결자 → 보임 ③일반 직원(비결재자) → 안 보임 ④일반 직원인데 진행 중 결재 걸림 → 보임 ⑤관리자 지정 안 됨 → 안 보임(휴가승인 등은 그대로) ⑥single 회사 → 무영향.

## 4. 작업분해 TODO
- [ ] 1. `approval-server.ts`: `isApprovalLineMember` 추가(cache, 회사격리)
- [ ] 2. `Sidebar.tsx`: showApprovals 계산 + groupsFor 파라미터 반영(admin·employee 공통)
- [ ] 3. tsc·eslint 0 + 임시라우트로 isApprovalLineMember 검증(부서장/대결자/일반/진행중) → 삭제
- [ ] 4. code-reviewer + 커밋

## 5. 핵심 스니펫(계획용)
```ts
// approval-server.ts
export const isApprovalLineMember = cache(async (companyId, userId) =>
  (await prisma.department.count({ where: { companyId, OR: [{ headUserId: userId }, { deputyUserId: userId }] } })) > 0
);
// Sidebar.tsx
const showApprovals = deptline && (approvalWaiting > 0 || await isApprovalLineMember(user.companyId, user.id));
const groups = groupsFor(user.role, showApprovals);
```

## 6. 구현 안 함
- /approvals 페이지 접근 자체 차단(불필요 — 이미 빈 화면·안전). 결재 동작 로직. 배지 규칙.

## 📌 사용자 메모
-
