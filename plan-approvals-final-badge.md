# Plan: 결재함에 "전결" 표시 추가 (2026-07-20) — 상태: 검토 대기

> 방금 병렬 작업이 끝낸 전결의 마무리. 신청자·관리자 화면엔 이미 "(전결)" 표시가 있으나 **결재함(/approvals)엔 없음** → 결재자가 "내 승인이 최종 확정(전결)인지" 결재함에서 못 봄. 그것만 추가.
> ⚠️ plan.md/research.md는 병렬 작업(전결)이 사용 중이라 이 파일로 분리 기록.

## 1. 접근 방식
- 전결 데이터는 이미 있음: `ApprovalStep.isFinal`(전결 종결 단계). `listMyApprovals`가 조회하는 `step`에 이미 포함됨.
- 결재함 항목에 `isFinal`을 실어 보내고, 화면에서 그 항목에 **"전결" 배지**를 단다(다른 화면과 같은 primary 색 "(전결)" 스타일).
- **동작·판정 로직은 일절 안 건드림** — 순수 표시 추가.

## 2. 수정 파일 (2개, add-only)
1. `webapp/lib/approval-server.ts`
   - `ApprovalInboxItem` 타입에 `isFinal: boolean` 추가.
   - leave·correction 두 분기에서 `isFinal: step.isFinal` 세팅(step은 내 현재 단계).
2. `webapp/app/approvals/page.tsx`
   - `it.isFinal`이면 단계 표시("N/M단계") 옆에 **"전결"** 배지 + 안내문 보강("전결 — 내가 승인하면 최종 확정").

## 3. 🛡️ 사이드 이펙트 방어
- `ApprovalInboxItem` 소비처 = **결재함 1곳뿐**(grep 확인) → 필드 추가는 완전 격리, 회귀 0.
- 스키마·마이그레이션 **없음**(isFinal 이미 존재). 서버 재시작 불필요.
- 손댈 두 파일 모두 미저장 변경 없음(병렬 작업과 비충돌 확인).
- 테스트할 것: ①일반 결재선(비전결) 항목엔 배지 안 뜸 ②전결 항목엔 "전결" 뜸 ③single 회사 무영향.

## 4. 작업분해 TODO
- [ ] 1. `approval-server.ts`: ApprovalInboxItem에 isFinal 추가 + 두 분기 세팅
- [ ] 2. `approvals/page.tsx`: 전결 배지 + 안내문
- [ ] 3. tsc·eslint 0 + 임시라우트로 listMyApprovals isFinal 검증(전결/비전결) → 삭제
- [ ] 4. code-reviewer 검수 + 커밋

## 5. 핵심 스니펫(계획용)
```tsx
// approval-server.ts: items.push({ ..., isFinal: step.isFinal })
// approvals/page.tsx (단계 표시 옆):
{it.isFinal && <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "#EAF2FF", color: "var(--primary)" }}>전결</span>}
```

## 6. 구현 안 함
- 조건별 결재선·자동 에스컬레이션(보류). 전결 로직 자체 수정(이미 완성·검증됨).

## 📌 사용자 메모
-
