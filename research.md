# Research: 결재이력 '직원 드롭다운' → 통합검색 전환 (2026-07-21)

## 배경
사장님 피드백: [결재이력] 필터의 **직원 드롭다운**은 직원 수백 명 회사에서 스크롤이 비현실적. → 프로젝트 공통 **통합검색(SearchBox)**으로 교체 요청.

## 관련 파일과 역할
- `webapp/app/approval-history/page.tsx` — 서버 컴포넌트. 현재: type/status/userId/기간 파싱 → emps(전 직원) 조회로 드롭다운 채움 + userId 서버필터 → listApprovalHistory → 표 인라인 렌더.
- `webapp/app/approval-history/ApprovalHistoryFilters.tsx` — 클라이언트 필터바(유형·상태·직원 select + 기간 달력, router.push 네비게이션만).
- `webapp/lib/search.ts` — **공통 통합검색 로직**: `queryTerms`(공백/쉼표 OR 분해)·`matchesTerms`(하나라도 포함)·`filterByQuery`. 무수정 재사용.
- `webapp/app/components/SearchBox.tsx` — **공통 검색 입력창**(제어형, 부모가 상태 소유, 지우기 버튼). 무수정 재사용.
- `webapp/lib/approval-history.ts` — `listApprovalHistory`. `userId` 필터는 옵션(안 넘기면 미적용). **시그니처 무변경**(userId는 그대로 두되 호출부에서 안 씀).

## 표준 패턴(정정승인 등 16개 화면과 동일)
- **서버**: 각 행에 검색용 문자열 `search`(신청자·사번·부서·내용·사유·처리자 등 소문자 결합)를 미리 만들어 클라이언트로 전달.
- **클라이언트**: `SearchBox` 상태 `q` 보유 → `matchesTerms(row.search, queryTerms(q))`로 **즉시 필터**(useMemo). URL 변경 없이 실시간.
- 참고 구현: `app/corrections/approvals/CorrectionApprovalsClient.tsx`(기간 서버나비 + SearchBox 클라이언트필터가 한 컴포넌트에 공존).

## 🔴 영향 범위 (전수 확인)
- `listApprovalHistory` 호출: **page.tsx 1곳뿐**. userId 안 넘겨도 lib 정상(필터 미적용).
- `ApprovalHistoryFilters` 사용: **page.tsx 1곳뿐**(페이지 전용).
- `lib/search.ts`·`SearchBox.tsx`·`RangeCalendar.tsx`·`lib/approval-history.ts` = **공통, 전부 무수정**.
- 직전 작업(제어형 select ①·조회기간 헤더 ②)은 **그대로 보존** 필요.

## 구조 변경 필요성
- SearchBox는 **실시간 클라이언트 필터**라, 검색창과 "필터 대상 표"가 **같은 클라이언트 컴포넌트** 안에 있어야 함(서버 인라인 표는 클라 상태로 못 거름).
- 따라서 현재 [필터바(클라)] + [표(서버 인라인)] 구조를 → **[필터바+표=한 클라이언트 컴포넌트]**로 통합(정정승인과 동일 구조). 유형·상태·기간은 그대로 router.push 서버나비, 직원 드롭다운 자리에 SearchBox.

## DB·API·위험
- **DB/스키마/마이그레이션 없음.** listApprovalHistory 쿼리·시그니처 무변경(userId만 미사용).
- **회사격리**: 서버가 여전히 companyId로 조회. 검색은 이미 걸러진(자사) 로드 행에서만 → 격리 무영향.
- **알려진 특성(보고필요)**: 통합검색은 **현재 로드된 행(유형·상태·기간 조건 + 최대 300건)** 안에서 필터. 특정 직원 전체 이력은 기간을 넓게 잡아 조합(타 화면과 동일 동작). 감사화면이므로 이 특성을 헤더/안내로 명시 권장.
- emps 전 직원 조회는 **더 이상 불필요** → 제거(userId 검증·드롭다운용이었음). 소폭 성능 이득.

## 결론 (계획 시)
1. page.tsx: userId·emps·userF 제거. 각 행에 `search` 문자열 부여. type/status/기간만 서버필터. 새 클라 컴포넌트에 rows+필터값 전달.
2. 새 `ApprovalHistoryClient.tsx`(클라): 유형·상태 select(제어형·router.push)+기간 RangeCalendar+**SearchBox**, 결과헤더(건수·조회기간), 표 렌더 + q로 즉시필터. 기존 ApprovalHistoryFilters는 이 컴포넌트로 흡수(삭제).
3. 직전 fix 보존: 유형·상태 제어형(value), 조회기간 헤더 유지.
4. 검증: tsc·eslint 0 + 3000 실서버(검색 즉시필터·유형/상태/기간 서버나비 공존·뒤로가기 표시일치·조회기간 헤더·콘솔0) + code-reviewer.
