# Research: 목록 화면 페이징(화면 페이징) 전면 적용 (2026-07-21)

## 배경
사장님 지시: 목록을 무한정 나열하면 렌더 부하·느려짐 → 첨부 이미지(MUI TablePagination 스타일: "페이지 당 행 [100▼]  1–100 / 184  < >")처럼 페이지 기능 추가. **모든 목록 나열 화면에 다** 적용. 방식=**화면 페이징(클라이언트)** 확정(데이터는 지금처럼 로드하되 화면엔 한 페이지씩만 렌더 → 렌더 부하 제거, 기존 통합검색·필터 그대로 유지, 저위험·전화면 균일 적용).

## 공통 패턴(전 목록 화면 동일)
- 각 목록 화면 = **클라이언트 컴포넌트**가 서버로부터 전체 행 배열을 받아 `useMemo`로 통합검색 필터(`matchesTerms`) → `배열.map()`으로 **전부 렌더**. (예: `EmployeeList.tsx` `a=active.filter(...)` → `a.map(...)`)
- 페이징 추가 = 필터 결과 배열을 `slice(page*size, +size)`로 잘라 렌더 + 공통 페이징 푸터. 검색/필터 바뀌면 page를 0으로 리셋, page가 범위 밖이면 클램프.

## 🔴 적용 대상 (목록 나열 화면) — 표를 실제 "행 목록"으로 쓰는 화면
### A. 관리자 단일표 목록 (길어질 수 있음 = 핵심)
- `approval-history/ApprovalHistoryClient`(방금 통합검색화) · `biometrics/BiometricsList` · `leave-summary/LeaveSummaryClient` · `records/RecordsClient` · `reports/ReportsClient`
### B. 관리자 2표 목록 (대기 + 처리내역 / 재직 + 퇴사)
- `employees/EmployeeList`(재직·퇴사) · `leave/approvals/LeaveApprovalsClient` · `corrections/approvals/CorrectionApprovalsClient` · `outing/approvals/OutingApprovalsClient` · `overtime/approvals/OvertimeApprovalsClient` · `remote/approvals/RemoteApprovalsClient` · `trip/approvals/TripApprovalsClient` — **각 표 독립 페이징**
### C. 보안 로그 목록
- `security/access/AccessLogClient` · `security/alerts/AlertsClient` · `security/logins/LoginHistoryClient` · `security/blocked/BlockedIpClient`(2표)
### D. 직원용 "내 신청" 목록 (서버 렌더 → 클라 분리 필요, 대개 짧음)
- `leave/page` · `outing/page` · `overtime/page` · `remote/page` · `trip/page` · `corrections/page`

## ⛔ 제외 (목록 나열 아님 = 페이징 부적합)
- `components/DetailTable.tsx` — 상세표(하루 근태 상세), 목록 아님.
- `reports/print/page.tsx` — 인쇄용(전량 출력해야 함).
- `shifts/FixedPatternClient`·`RotationClient` — 교대 패턴 설정(고정 소형 표, 긴 목록 아님).

## 공통 모듈 여부 / 위험
- **신규 공통 부품 `TablePagination`(+옵션 훅) 1개** 생성 → 각 화면이 사용. 공통 SearchBox/RangeCalendar/lib/search **무수정**.
- **DB/스키마/API/서버액션 변경 없음**(화면 페이징=순수 클라). 회사격리·권한 로직 무접촉.
- 위험: 낮음(렌더 slice·add-only). 주의점: ①검색/필터 변경 시 page 리셋 ②total=0 표시 ③각 화면 2표는 페이징 상태 분리 ④승인/반려 등 액션 후 목록 갱신 시 page 클램프.
- **부하 특성(사장님 보고)**: 화면 페이징은 **렌더 부하**를 없앰(수천 행 DOM→100행). **DB 조회·전송량**은 그대로(그건 서버 페이징=대공사, 이번 범위 밖). 대량회사에서 전송량까지 줄이려면 추후 서버 페이징 별도 착수.

## 결론 (계획)
1. 공통 `TablePagination.tsx`(이미지 디자인: 페이지 당 행 select[50/100/200] + "start–end / total" + ◀▶) + 작은 `usePagination` 훅(page·size·클램프·리셋).
2. 화면들을 **A→B→C→D 순 배치(batch)로 적용**, 배치마다 tsc·eslint·실화면·커밋. 각 표는 필터 뒤 slice.
3. 기본 페이지크기=100(이미지와 동일), 옵션 50/100/200. 총건수 ≤ 최소옵션이어도 푸터 표시(균일, 화살표 비활성).
4. 검증: tsc·eslint 0 + 3001 실서버(페이지 이동·크기변경·검색과 상호작용·경계) + code-reviewer.
