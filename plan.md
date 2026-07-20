# Plan: 결재이력 '직원 드롭다운' → 통합검색 전환 — 2026-07-21 — 상태: 검토 대기

> 목표: 수백 명 회사에서 비현실적인 직원 드롭다운을 제거하고, 프로젝트 공통 통합검색(SearchBox)으로 교체. 신청자 이름·사번·부서·내용·사유·처리자를 한 검색창에서 OR로 즉시 검색.

## 1. 접근 방식 (+이유)
- **공통 패턴 그대로**: 다른 16개 화면(정정승인·휴가승인 등)과 동일하게 `SearchBox`+`lib/search`로 **로드된 행을 실시간 클라이언트 필터**. 사장님이 이미 쓰는 방식과 일치.
- **구조 통합**: SearchBox는 검색창과 표가 같은 클라이언트 컴포넌트에 있어야 필터가 걸림 → 현재 [필터바(클라)+표(서버인라인)]를 **한 클라이언트 컴포넌트**로 합침(정정승인 구조 복제). 유형·상태·기간은 그대로 router.push 서버 조회.
- **직전 개선 보존**: 유형·상태 select는 제어형(value) 유지(뒤로가기 표시 일치), 결과 헤더 '조회 기간' 표시 유지.

## 2. 수정/생성 파일 목록
- `webapp/app/approval-history/page.tsx` (수정) — userId·emps·userF 제거. 각 행에 검색용 `search` 문자열 생성. 새 클라 컴포넌트로 rows+필터값 전달. (표 렌더 코드는 클라로 이동)
- `webapp/app/approval-history/ApprovalHistoryClient.tsx` (**신규**) — 필터바(유형·상태 select + 기간 RangeCalendar + **SearchBox**) + 결과헤더 + 표. `q` 상태로 즉시 필터. 기존 배지/스타일 이관.
- `webapp/app/approval-history/ApprovalHistoryFilters.tsx` (**삭제**) — 신규 클라 컴포넌트로 흡수.
- **공통 무수정**: lib/search.ts·SearchBox.tsx·RangeCalendar.tsx·lib/approval-history.ts. **DB/마이그레이션 없음.**

## 3. 🛡️ 사이드 이펙트 방어
- **영향받을 수 있는 기능 + 대응**:
  - 유형·상태·기간 필터: 서버 router.push 방식 그대로 유지 → 동작 무변경. 제어형 select도 유지(뒤로가기 표시 일치).
  - 조회 기간 헤더 표시(직전 작업): 클라 컴포넌트로 옮기되 문구·로직 그대로 유지.
  - listApprovalHistory: userId만 안 넘김. lib 시그니처·쿼리·회사격리 무변경 → 다른 동작 영향 0.
  - 기존 URL 북마크에 `userId=...`가 있어도: 서버가 무시(파싱 제거) → 에러 없이 전체 조회. 하위호환.
- **구현 후 반드시 테스트할 기존 기능**:
  1. 유형·상태 필터 선택 → 결과·표시 일치(제어형).
  2. 기간 달력 적용 → 범위 조회 + 헤더 기간 라벨 일치.
  3. **뒤로가기/앞으로가기** → 유형·상태 드롭다운 표시가 결과와 일치.
  4. **통합검색**: 이름·사번·부서·내용·사유·처리자 각각으로 실시간 필터, 여러 단어 OR, 지우기.
  5. 초기화 → 기본(이번 달·검색어 없음) 복귀.
  6. 검색 결과 0건·조회 0건 안내 문구.
  7. 비관리자·미인증 접근 차단(기존 redirect) 유지, 회사격리 유지.

## 4. 작업분해 TODO (1개 = 독립 완성·확인 단위)
- [ ] 1단계: 신규 `ApprovalHistoryClient.tsx` 생성 — 필터바(유형·상태·기간)+SearchBox+결과헤더+표, `q` 즉시필터. (기존 page.tsx의 표/배지/스타일 이관)
- [ ] 2단계: `page.tsx` 수정 — userId·emps·userF 제거, 각 행 `search` 문자열 생성, ApprovalHistoryClient에 rows+필터값 전달.
- [ ] 3단계: `ApprovalHistoryFilters.tsx` 삭제 + import 정리.
- [ ] 4단계: tsc·eslint 0 확인.
- [ ] 5단계: 3000 실서버 검증(§3 목록 7항목) + 콘솔0.
- [ ] 6단계: code-reviewer 검수 + project-status.md 갱신 + 커밋.

## 5. 핵심 로직 샘플 (계획용, 실제 구현 아님)
```tsx
// page.tsx — 행에 검색 문자열 부여(서버)
const rows = await listApprovalHistory(me.companyId, filter); // userId 안 넘김
const clientRows = rows.map((r) => ({
  ...r,
  search: [r.applicantName, r.applicantNo, r.applicantDept, TYPE_LABEL[r.type],
           r.summary, r.reason, STATUS_LABEL[r.status], r.decidedByName]
          .filter(Boolean).join(" ").toLowerCase(),
}));
// <ApprovalHistoryClient rows={clientRows} type={typeF} status={statusF} from={fromISO} to={toISO} todayISO={todayISO} />
```
```tsx
// ApprovalHistoryClient.tsx (client)
const [q, setQ] = useState("");
const shown = useMemo(() => { const t = queryTerms(q); return rows.filter((r) => matchesTerms(r.search, t)); }, [q, rows]);
// 필터바: 유형 select(value, router.push) · 상태 select · RangeCalendar · <SearchBox value={q} onChange={setQ} placeholder="신청자·내용·사유 검색" />
// 헤더: 조회 결과 {shown.length}건 · 조회 기간(신청일 기준): {from} ~ {to}
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- 서버측 전체DB 이름검색/페이징(상한 300 유지). 통합검색은 로드된 행(유형·상태·기간+300) 내 필터 — 타 화면과 동일. **특정 직원 전체이력은 기간을 넓게 잡아 조합**(헤더/플레이스홀더로 안내).
- 공통 컴포넌트(SearchBox·RangeCalendar·lib/search·listApprovalHistory) 수정.
- 유형·상태 필터의 검색화(작은 고정목록이라 드롭다운이 적절).

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
