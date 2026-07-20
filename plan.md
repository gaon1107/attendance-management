# Plan: 목록 화면 페이징(화면 페이징) 전면 적용 — 2026-07-21 — 상태: 검토 대기

> 목표: 첨부 이미지 스타일(페이지 당 행 [100▼] · 1–100 / 184 · ◀▶)의 공통 페이징을 모든 목록 나열 화면에 적용. 방식=화면 페이징(데이터는 로드, 화면엔 한 페이지씩 렌더 → 렌더 부하 제거). 통합검색·필터·디자인 유지, 저위험.

## 1. 접근 방식 (+이유)
- **공통 부품 1개 신규**: `app/components/TablePagination.tsx`(이미지 디자인 재현) + 작은 훅 `app/components/usePagination.ts`(page·pageSize 상태, 총건수 바뀌면 범위 클램프, 검색어/필터 바뀌면 1페이지로 리셋). 부품 하나로 전 화면 균일·중복 최소화.
- **각 화면 최소 변경**: 지금 `filtered.map(...)` 하는 곳을 `filtered.slice(...).map(...)`로 바꾸고 표 아래 `<TablePagination .../>` 추가. 서버·데이터 흐름 무변경.
- **2표 화면**: 대기/처리내역(또는 재직/퇴사) 각 표에 **독립 페이징**(훅 2개).
- **직원용 page.tsx(내 신청)**: 목록 부분을 작은 클라 컴포넌트로 분리해 동일 적용(approval-history에서 쓴 방식과 동일).

## 2. 수정/생성 파일 목록
- **신규**: `app/components/TablePagination.tsx`, `app/components/usePagination.ts`
- **수정(관리자 단일표)**: ApprovalHistoryClient · BiometricsList · LeaveSummaryClient · RecordsClient · ReportsClient
- **수정(관리자 2표)**: EmployeeList · LeaveApprovalsClient · CorrectionApprovalsClient · OutingApprovalsClient · OvertimeApprovalsClient · RemoteApprovalsClient · TripApprovalsClient
- **수정(보안)**: AccessLogClient · AlertsClient · LoginHistoryClient · BlockedIpClient
- **수정(직원 내신청·클라 분리)**: leave/page · outing/page · overtime/page · remote/page · trip/page · corrections/page (각 목록용 소형 클라 컴포넌트 신설)
- **무수정(제외)**: DetailTable · reports/print · shifts/FixedPattern·Rotation (목록 아님)
- **DB/마이그레이션/서버액션 없음.**

## 3. 🛡️ 사이드 이펙트 방어
- **영향받을 수 있는 기능 + 대응**:
  - 통합검색: 검색은 전체 필터→그 결과를 페이징. 검색어 바뀌면 page=0 리셋(빈 페이지 방지).
  - 기간/상태 등 기존 필터: 무변경(서버 조회 그대로), 필터 결과에 페이징만 얹음.
  - 승인/반려/삭제 등 액션 후 목록 재조회: 행 수 줄면 현재 page가 범위 밖일 수 있음 → 훅이 자동 클램프(마지막 페이지로).
  - 인쇄(reports/print): 제외 → 전량 출력 유지.
  - 정렬/합계(리포트 등): 페이징은 렌더만 자르므로 서버 합계·정렬 무영향.
- **구현 후 반드시 테스트할 기존 기능(화면별)**:
  1. 페이지 이동(◀▶), 페이지 크기 변경(50/100/200), 범위표시(start–end / total) 정확.
  2. 통합검색과 동시 사용 → 검색 시 1페이지로, 결과 페이징 정확.
  3. 2표 화면 두 표 독립 페이징.
  4. 액션(승인/반려/삭제) 후 목록·페이지 정상.
  5. 총건수 0·1페이지 경계(화살표 비활성).
  6. 각 화면 권한/회사격리(서버측) 불변.

## 4. 작업분해 TODO (배치 단위 — 배치마다 tsc·eslint·실화면·커밋)
- [ ] 0단계: 공통 `TablePagination` + `usePagination` 생성 + 임시 검증(경계·클램프)
- [ ] 1단계(배치A): 관리자 단일표 5개 적용 → 검증·커밋
- [ ] 2단계(배치B): 관리자 2표 승인·직원 7개 적용 → 검증·커밋
- [ ] 3단계(배치C): 보안 로그 4개 적용 → 검증·커밋
- [ ] 4단계(배치D): 직원 "내 신청" 6개(클라 분리) 적용 → 검증·커밋
- [ ] 5단계: 전체 3001 실서버 검증(대표 화면들 페이지·크기·검색 상호작용) + 콘솔0
- [ ] 6단계: code-reviewer 검수 + project-status.md 갱신 + 최종 커밋

## 5. 핵심 로직 샘플 (계획용, 실제 구현 아님)
```tsx
// usePagination.ts
export function usePagination<T>(items: T[], initialSize = 100) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, pageCount - 1);       // 클램프
  const start = total === 0 ? 0 : safePage * size;
  const view = items.slice(start, start + size);
  // items 길이/검색 바뀌어 page 범위 벗어나면 자동 보정
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [pageCount, page]);
  return { view, page: safePage, setPage, size, setSize, total, start, end: start + view.length, pageCount };
}
```
```tsx
// TablePagination.tsx (이미지 디자인)
// [페이지 당 행: <select 50/100/200>]   {start+1}–{end} / {total}   [◀ disabled at 0] [▶ disabled at last]
// 화면 사용: const pg = usePagination(filtered, 100);  pg.view.map(...)  <TablePagination pg={pg} />
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- **서버 페이징**(DB LIMIT/OFFSET·서버검색): 진짜 전송량 감축이나 대공사·회귀위험(통합검색 재설계). 사장님 결정=화면 페이징. 대량회사 실불편 시 추후 별도.
- 목록 아닌 표: DetailTable(상세)·reports/print(인쇄)·shifts 패턴(설정) — 제외.
- URL에 페이지 상태 저장(북마크): 이번 범위 밖(클라 상태로 충분).

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
