# Research: 결재이력 날짜필터 수정(저비용 2건) (2026-07-21)

## 배경
관리자 [결재이력] 화면(감사·내부통제 조회용)의 code-reviewer 지적 2건(미반영, 치명 아님):
- **①비제어 select 뒤로가기 어긋남**: 유형·상태·직원 드롭다운이 `defaultValue`(비제어)라, 브라우저 **뒤로/앞으로** 이동 시 URL·결과는 바뀌는데 드롭다운 표시는 마지막 선택값에 머물러 **표시와 실제 결과가 불일치**. 감사 화면이라 신뢰성 문제.
- **②기본기간 '이번 달' 조용히 숨김**: 기간 미지정 시 기본이 '이번 달'이라, 과거 이력이 화면 어디에도 안내 없이 **조용히 제외**됨. 감사 화면에서 위험.

## 관련 파일과 역할
- `webapp/app/approval-history/page.tsx` — 서버 컴포넌트. searchParams(type/status/userId/from/to) 파싱 → 기본기간=이번 달 계산 → `listApprovalHistory` 조회 → 표 렌더. 필터바에 `ApprovalHistoryFilters` 렌더.
- `webapp/app/approval-history/ApprovalHistoryFilters.tsx` — **클라이언트** 필터바. 문제의 `<select defaultValue=...>` 3개 + 공통 `RangeCalendar`. onChange→`router.push`.
- `webapp/lib/approval-history.ts` — 조회 로직. `HistoryFilter.from/to`가 **null/undefined면 createdAt 범위 필터를 아예 안 걸어 전체 기간 조회**(84~86행). → "전체 기간" 구현 가능(별도 스키마·쿼리 변경 불필요).
- `webapp/app/components/RangeCalendar.tsx` — **공통 컴포넌트**(여러 화면 사용). 버튼 표시는 `from/to` prop을 직접 사용 → prop 바뀌면 즉시 갱신되어 **뒤로가기 어긋남 없음**. → **건드리지 않음**.

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳)
- `ApprovalHistoryFilters` import처: **`app/approval-history/page.tsx` 단 1곳**(전수 확인). 페이지 전용 컴포넌트 → 격리됨.
- 비제어 `select defaultValue + router.push` 패턴: 전 webapp에서 **이 파일(ApprovalHistoryFilters.tsx) 3곳뿐**(grep 전수). 다른 화면 영향 없음.
- `listApprovalHistory` 시그니처 변경 **없음**(from/to에 null을 넘기는 것은 기존에 이미 허용된 입력).

## 공통 모듈 여부 / 건드리면 안 되는 부분
- **RangeCalendar = 공통 모듈** → 수정 대상 아님(표시 로직 이미 안전). safe-coding 절차 불필요(안 건드림).
- **listApprovalHistory = 공통 조회** → 시그니처·쿼리 무변경, null 입력만 활용.
- 수정 범위는 **페이지 전용 파일 2개**(page.tsx, ApprovalHistoryFilters.tsx)로 한정.

## DB·API 변경 여부, 위험 요소
- **DB/스키마 변경 없음.** 마이그레이션 없음.
- **API·서버액션 변경 없음.** URL searchParams만 추가(`all=1` 전체기간 플래그, add-only·기존 URL 호환).
- **회사격리**: 기존 `listApprovalHistory`의 companyId 격리 그대로. 필터 파라미터만 조정 → 격리 무영향.
- 위험: 낮음. "전체 기간"은 상한 300건(HISTORY_LIMIT)이 그대로 걸려 대량조회 폭주 없음.

## 결론 (계획 시 고려사항)
1. **①비제어→제어**: 3개 select를 `value={...}`(제어형)로 전환. onChange는 그대로 router.push. 서버가 새 prop을 내려주면 표시=실제결과 항상 일치.
2. **②조용한 숨김 해소**: (a) 결과 헤더에 **현재 조회 기간을 명시**(전체 기간이면 "전체 기간") + (b) 필터바에 **"전체 기간" 버튼** 추가(URL `all=1` → from/to null → 전체 조회).
3. `build()`에 `all` 상태 반영: 다른 필터(유형/상태/직원) 변경 시 현재 기간 모드(이번달/특정범위/전체) 유지. 달력 적용 시 all 해제.
4. 검증: tsc·eslint 0 + 임시라우트(build URL 조합·전체기간 null 조회) + 실화면(뒤로가기 표시 일치·전체기간 조회) + code-reviewer.
