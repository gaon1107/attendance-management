# Research: 결재선 2차 — 반려사유 + 결재이력 피드백 (2026-07-19)

> 범위(사장님 확정): 결재선 2차 4후보 중 **①번(반려사유 입력 + 신청자에게 결재 이력/사유 피드백)**.
> 전결·조건별·자동에스컬레이션은 이번 범위 제외(별도 조각).

## 관련 파일과 역할

- `webapp/lib/approval.ts` — 순수함수(체인 계산·단계 판정). 이번 작업에서 **수정 없음**(로직 불변).
- `webapp/lib/approval-server.ts` — DB 로직. `advanceApproval`(승인/반려 단계진행)·`getApprovalProgressMap`(진행표시). **여기에 comment 저장·이력 조회 추가**.
- `webapp/app/actions/leave.ts` — `approveLeave`/`rejectLeave` (서버액션). **comment 수신·저장 추가**.
- `webapp/app/actions/corrections.ts` — `approveCorrection`/`rejectCorrection`. **동일 패턴 추가**.
- `webapp/app/approvals/page.tsx` — 부서장 결재함(서버 컴포넌트). 반려 폼에 사유 입력.
- `webapp/app/leave/approvals/LeaveApprovalsClient.tsx` — 관리자 휴가 승인(클라이언트, 테이블 행 폼). 반려 사유.
- `webapp/app/corrections/approvals/CorrectionApprovalsClient.tsx` — 관리자 근태정정 승인. 동일.
- `webapp/app/leave/page.tsx` / `webapp/app/corrections/page.tsx` — 신청자 본인 목록. **반려/승인 결과·사유 표시 추가**.
- `webapp/prisma/schema.prisma` — `ApprovalStep.comment`(이미 존재), `LeaveRequest`·`AttendanceCorrection`(결정사유 컬럼 없음 → 추가).

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳 — 전수 grep 결과)

**승인/반려 액션 호출처 = 3곳** (`approveLeave/rejectLeave`·`approveCorrection/rejectCorrection`):
1. `app/approvals/page.tsx` (부서장 결재함, 서버 컴포넌트, 카드형 폼)
2. `app/leave/approvals/LeaveApprovalsClient.tsx` (관리자, 클라이언트, 테이블 행 폼)
3. `app/corrections/approvals/CorrectionApprovalsClient.tsx` (관리자, 클라이언트, 테이블 행 폼)
→ **반려 사유 입력 UI를 3곳에 넣어야 함** → 재사용 클라이언트 컴포넌트 1개(`RejectButton`)로 통일.

**진행표시(`getApprovalProgressMap`) 소비처 = 4곳**: `leave/page.tsx`·`corrections/page.tsx`(신청자)·`leave/approvals/page.tsx`·`corrections/approvals/page.tsx`(관리자). 시그니처는 **바꾸지 않음**(반환 타입 확장만, 기존 필드 유지 → 회귀 0).

**`advanceApproval` 호출처 = 4곳**(위 leave/corrections 액션 4개). 시그니처에 **선택 파라미터 `comment` 추가**(기존 호출 무영향).

## 공통 모듈 여부 / 건드리면 안 되는 부분

- `advanceApproval`·`getApprovalProgressMap`은 **공통 함수**(여러 액션·화면이 의존) → safe-coding 절차: 파라미터는 **선택(optional) 추가만**, 반환 타입은 **필드 추가만**(기존 필드·동작 불변).
- `lib/approval.ts` 순수함수(단계 판정)는 **건드리지 않음** — 승인/반려 판정 규칙 자체는 그대로. comment는 판정과 무관한 부가정보.
- **원칙 A(회귀 0의 핵심)**: 원본 status는 여전히 "마지막 단계 승인 시에만 approved". comment 저장은 status 전환과 독립 → 소비처 9곳 회귀 0 유지.

## DB·API 변경 여부, 위험 요소

- **DB 변경**: add-only. `LeaveRequest`·`AttendanceCorrection`에 `decisionComment String?`·`decidedById String?` 추가(둘 다 nullable → 기존 행 무영향). `ApprovalStep.comment`는 이미 존재(마이그레이션 불필요).
  - 마이그레이션 시 **dev 서버 종료 필요**(EPERM DLL 잠금 함정).
- **동시성**: 반려/승인은 이미 `status:"pending"` 가드로 멱등. comment 저장을 같은 `updateMany` 데이터에 합치면 원자성 유지.
- **보안/격리**: comment는 회사격리 쿼리 안에서만 저장·조회. XSS — 표시는 React 기본 이스케이프(dangerouslySetInnerHTML 미사용). 입력 길이 상한(예 500자) 검증.
- **single 모드**: ApprovalStep 없음 → 결정사유는 원본의 `decisionComment`에 저장(uniform). deptline은 단계별 `ApprovalStep.comment` + 최종 결정사유 원본에도 미러(신청자 표시 간결화).

## 결론 (계획 시 고려사항)

1. 저장 이원화: deptline=단계별 comment(ApprovalStep) + 최종 결정사유 원본 미러 / single=원본 decisionComment 직접.
2. 반려 사유 입력 UI는 **재사용 컴포넌트 1개**로 3곳 통일(테이블/카드 모두 수용).
3. 진행표시·판정 순수함수는 불변 — 회귀 0 유지가 최우선.
4. 미결정 사항(계획서 메모로 확인): ①반려사유 **필수 vs 선택** ②승인사유도 입력 받을지 ③다단계 이력 타임라인을 신청자 화면에 노출할지.
