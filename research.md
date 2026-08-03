# Research: 최종 검수 후속 6건 (2026-08-03)

> 대상: project-status.md "다음 세션 할 일 1순위" — plan.md "A. 최종 검수에서 남긴 후속 과제" 6건
> (이전 research는 git 이력에 보존)

## 관련 파일과 역할

| 작업 | 핵심 파일 |
|---|---|
| ① 퇴사자 데이터 일회성 정리 | `webapp/prisma/migrations/` (신규 SQL), 선례: `20260726050000_pcoff_retention_defaults` (데이터 백필 UPDATE 포함) |
| ② 결재선 퇴사자→대결자 대체 | `webapp/lib/approval.ts:47` (candidate = head ?? deputy), `webapp/lib/approval-server.ts:125-153` (H-6 사후 필터), `:440-445` (isApprovalLineMember) |
| ③ 임시비번 가드 | `webapp/lib/session.ts:26-44` `getCurrentUser()` — **90개 파일 156곳에서 사용하는 공통 모듈** |
| ④ 리포트 KPI 평균 희석 | `webapp/app/reports/ReportsClient.tsx:68-77` (분모 = filtered.length, 0시간 직원 포함) |
| ⑤ skipped 단계 이력 표시 | `webapp/lib/approval-history.ts` (approvalStep을 아예 안 읽음), `app/approval-history/*` 2개 |
| ⑥ 야간 교대 릴리스 노트 | 문서만 (effectiveEnd 도입으로 대시보드 주52·초과근무·휴게 3화면 숫자 변경) |

## 🔴 영향 범위

### ② 결재선 (가장 중요한 발견)
- **퇴사 처리(H-6, `app/actions/employees.ts:136-205`)가 이미 부서장/대결자 칸을 null로 비운다** →
  앞으로 퇴사하는 부서장은 기존 로직(`head ?? deputy`)만으로 대결자에게 넘어간다.
- 실제 남은 구멍 2개:
  1. **H-6 이전에 퇴사한 사람**의 `headUserId`/`deputyUserId` 잔존 참조 + 멈춘 pending 단계 (→ 작업①이 해결)
  2. `resolveApproverChain`의 **사후 필터**가 퇴사자를 "빼기만" 함 — 그 부서의 deputy로 대체하지 않고,
     전결(isFinal) 단계였으면 표시가 통째로 사라지며 **체인이 거기서 잘림**(상위 단계도 안 만들어짐)
- `buildApprovalChain` 호출처: `approval-server.ts:136` 단 1곳. `createApprovalStepsIfNeeded` 호출처 7곳(6종 신청 + agent overtime) — 시그니처 안 바꾸면 무영향.
- **`isApprovalLineMember`(사이드바 결재함 메뉴 게이팅)는 buildApprovalChain 규칙과 일치해야 함** — 규칙을 바꾸면 여기도 같이.
- 엣지: 대결자도 퇴사 / 대결자=신청자 본인(seen으로 배제 유지) / 대결자가 상위 단계와 중복 / 전결권자 퇴사 시 isFinal 승계.
- 부수 구멍(보고): `app/actions/departments.ts:90-99` 부서장/대결자 저장 시 `deactivatedAt: null` 미검사 → 폼 위조로 퇴사자 지정 가능.

### ③ 임시비번 가드 (공통 모듈 — safe-coding 대상)
- `getCurrentUser()`에 mustChangePassword 차단을 넣으면 156곳 전부 즉시 보호.
- **반드시 예외(allowMustChange)가 필요한 곳**: `app/change-password/page.tsx`(무한루프 방지),
  `app/actions/account.ts` changePassword(변경 자체), `app/actions/auth.ts` logout(로그아웃 기록). AppShell 경유 페이지는 null→`redirect("/login")`으로 안전.
- 구멍 실측: 세션 기반 route 13개(`app/api` 8 + **api 밖 export 라우트 4** + kicc-test) + `reports/print/page.tsx`(AppShell 미사용 9개 페이지 중 유일한 로그인 화면) + 서버액션 31파일 106곳 — 전부 mustChangePassword 무검사.
- agent 라우트 4개는 기기토큰 인증(브라우저 세션 무관) → 대상 아님.

### ④ KPI
- 계산은 화면 1곳뿐. 엑셀은 의도적으로 평균 없음(빈칸 정책), PDF도 없음. 대시보드 "오늘 실근무 평균"은 별개(이미 0시간 미포함).

### ⑤ skipped
- `skipped` 생성 경로는 퇴사 처리 1곳뿐. 이력 화면은 **신청 원본 status만** 조회하므로 skipped 뱃지가 뜰 일은 없음.
- 실제 증상: 퇴사로 건너뛴 신청이 이력에서 그냥 "대기" — `approvalProgressLabel`(승인 화면 13곳이 쓰는 공통 문구)이 이력 화면에만 없음.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- `getCurrentUser`(90파일)·`buildApprovalChain`(순수함수)·`approvalProgressLabel`(13곳) = 공통. 시그니처는 **추가 인자(옵션)만** 허용, 기존 호출 무변경.
- 결재 엔진 불변식: 원본 status는 전 단계 승인 시에만 approved / companyId 격리 / add-only 스키마.

## DB·API 변경
- 작업①: 마이그레이션 1건(데이터 UPDATE만, 스키마 무변경). 선례 있음.
- 나머지: 스키마 무변경.

## 결론 (계획 시 고려)
- 순서: ②(로직) → ①(정리 — 로직과 정리 기준 일치) → ③ → ④ → ⑤ → ⑥(문서).
- ②는 "사후 필터"를 "사전 alive 주입"으로 옮겨 buildApprovalChain 안에서 대체·승계를 판단하게 한다.
- ③은 getCurrentUser 옵션 방식(기본 차단 + 예외 3곳)이 최소 수정·최대 커버.
