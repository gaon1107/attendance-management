# Plan: 결재선 2차 — 반려사유 + 결재이력 피드백 (2026-07-19) — 상태: 검토 대기

## 1. 접근 방식 (+이유)

**목표**: 결재자가 반려(또는 승인)할 때 **사유를 남기고**, 신청자가 결과 화면에서 **"누가·언제·왜"**를 볼 수 있게 한다. 지금은 신청자가 "부서장 반려 처리 중"만 보고 이유를 모른다.

- **저장 위치(이원화, add-only)**:
  - deptline(부서장 결재선): 단계별 사유는 기존 `ApprovalStep.comment`(이미 존재)에 저장 + 최종 결정사유는 원본에도 미러.
  - single(기본·기존): ApprovalStep이 없으므로 원본(LeaveRequest/AttendanceCorrection)에 새 컬럼 `decisionComment`·`decidedById`로 저장.
  - → 두 모드 모두 **원본에서 최종 결정사유를 읽어** 신청자에게 표시(표시 로직 단순화). deptline 다단계 이력은 별도 조회.
- **회귀 0 유지**: 원본 status 전환 규칙(마지막 단계 승인 시에만 approved)·판정 순수함수·진행표시 시그니처는 **불변**. 새 컬럼은 nullable → 기존 회사·기존 행 무영향.
- **반려 사유 입력 UI**: 승인/반려 폼이 3곳(부서장 결재함·관리자 휴가승인·관리자 근태정정승인)에 흩어져 있고 레이아웃이 달라(카드/테이블행) → **재사용 클라이언트 컴포넌트 `RejectButton` 1개**로 통일(클릭 시 사유 입력창 노출 후 제출).

## 2. 수정/생성 파일 목록

**스키마·마이그레이션**
- `webapp/prisma/schema.prisma` — `LeaveRequest`·`AttendanceCorrection`에 `decisionComment String?`·`decidedById String?` 추가(add-only). 마이그레이션 생성(서버 끄고).

**서버 로직(공통 함수 — safe-coding: 선택 파라미터/필드 추가만)**
- `webapp/lib/approval-server.ts`
  - `advanceApproval(me, type, id, action, comment?)` — comment를 해당 단계 ApprovalStep에 저장(선택 파라미터, 기존 호출 무영향).
  - 신규 `getApprovalHistory(companyId, type, requestId)` — 단계별 {순서·결재자이름·상태·처리시각·사유} 배열 반환(deptline 이력 표시용).
- `webapp/app/actions/leave.ts` — `approveLeave`/`rejectLeave`: formData에서 `comment` 읽어 advanceApproval에 전달 + 원본 확정 시 `decisionComment`·`decidedById` 미러 저장(같은 updateMany 원자화). 길이 상한 검증.
- `webapp/app/actions/corrections.ts` — 동일 패턴.

**화면**
- `webapp/app/components/RejectButton.tsx` (신규, 클라이언트) — 반려 버튼+사유 입력. 3곳 공용.
- `webapp/app/approvals/page.tsx` — 반려 폼을 RejectButton으로 교체(+승인 사유 선택 입력).
- `webapp/app/leave/approvals/LeaveApprovalsClient.tsx` — 반려 폼을 RejectButton으로 교체.
- `webapp/app/corrections/approvals/CorrectionApprovalsClient.tsx` — 동일.
- `webapp/app/leave/page.tsx` — 신청자 목록: 반려/승인된 건에 **결정사유·처리자·처리시각** 표시.
- `webapp/app/corrections/page.tsx` — 동일.

## 3. 🛡️ 사이드 이펙트 방어

**영향받을 수 있는 기능 + 대응**
- `advanceApproval` 호출 4곳 → comment는 **선택 파라미터**라 미전달 시 기존과 동일(undefined 무시). ✅
- `getApprovalProgressMap` 소비 4곳 → 이 함수는 **건드리지 않음**(이력은 별도 신규 함수). ✅
- 원본 status 소비처 9곳(dashboard·reports·records 등) → status 전환 규칙 불변, 새 컬럼은 이 9곳이 읽지 않음 → 회귀 0. ✅
- single 모드(대다수 회사) → 반려 시 새 컬럼에만 사유 저장, 승인/반려 판정·표시는 기존 그대로 + 사유만 추가 노출. ✅
- RejectButton 교체 → 제출 필드(name="id")·서버액션 동일, name="comment"만 추가 → 서버는 선택 수신. 기존 승인 버튼 무수정. ✅

**구현 후 반드시 테스트할 기존 기능**
- single 회사: 관리자 휴가/근태정정 **반려·승인**이 기존과 동일하게 동작(+사유 저장·표시).
- deptline 회사: 부서장 결재함 다단계 **승인 진행·반려**가 기존과 동일 + 단계별 사유 기록.
- 신청자 화면: pending 진행표시(기존)·approved/rejected 결과+사유(신규) 동시 정상.
- 사유 미입력(선택 모드일 때)·초과길이 입력 방어.

## 4. 작업분해 TODO

- [ ] 1. schema에 `decisionComment`·`decidedById` 추가 + 마이그레이션(서버 끄고 generate 확인)
- [ ] 2. `advanceApproval`에 comment 선택 파라미터 + 단계 저장 / `getApprovalHistory` 신규 (임시라우트 경계 검증)
- [ ] 3. `actions/leave.ts`·`actions/corrections.ts`: comment 수신·원본 미러 저장·길이검증
- [ ] 4. `RejectButton` 공용 컴포넌트 신규 + 3곳(결재함·휴가승인·근태정정승인) 반려폼 교체
- [ ] 5. 신청자 화면(`leave/page.tsx`·`corrections/page.tsx`) 결정사유·처리자·시각 표시(+deptline 이력)
- [ ] 6. 영향받는 기존 기능 테스트(single/deptline 승인·반려 회귀 0, 신청자 표시)
- [ ] 7. 검수(code-reviewer) + tsc·eslint 0 + project-status.md 갱신

## 5. 핵심 로직 샘플 (계획용 스니펫, 실제 구현 아님)

```ts
// advanceApproval: 단계 승인/반려 시 comment 함께 저장(선택)
await prisma.approvalStep.update({
  where: { id: cur.id },
  data: { status: "rejected", decidedAt: now, comment: comment ?? null },
});

// 원본 확정 시 결정사유 미러(멱등 updateMany에 합침)
await prisma.leaveRequest.updateMany({
  where: { id: lv.id, companyId: me.companyId, status: "pending" },
  data: { status: "rejected", decidedAt: new Date(), decisionComment: comment ?? null, decidedById: me.id },
});
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)

- 전결·조건별 결재선·자동 에스컬레이션 — 별도 조각(이번 범위 아님).
- 반려 후 재신청 알림·이메일/문자 발송 — 별도 사안("죽은 스위치 금지" 원칙, 화면 표시로 충분).
- 근태정정/휴가 외 신규 신청유형 — 무관.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요) — 기본값 확인 부탁

- **① 반려 사유 = 필수?** (제 기본안: **필수 입력**. 사유 없는 반려는 UX가 나쁨) → 유지/변경:
- **② 승인 사유도 입력받나?** (제 기본안: **선택 입력**. 승인은 보통 사유 불필요) → 유지/변경:
- **③ 다단계 이력 타임라인을 신청자 화면에 노출?** (제 기본안: **최종 결과+사유만 크게, 단계별 이력은 접힘/간단표시**) → 유지/변경:
- 그 외 메모:
