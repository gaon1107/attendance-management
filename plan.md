# Plan: 결재이력 날짜필터 수정(저비용 2건) — 2026-07-21 — 상태: 검토 대기

> 목표: 관리자 [결재이력] 감사 화면의 신뢰성 지적 2건 해소.
> ① 드롭다운 표시가 뒤로가기 때 실제 결과와 어긋나는 문제 → 제어형으로.
> ② 기본기간 '이번 달'이라 과거 이력이 조용히 숨는 문제 → 조회 기간 명시 + "전체 기간" 버튼.

## 1. 접근 방식 (+이유)
- **①비제어→제어형 select**: `defaultValue`(브라우저 DOM이 값 소유, 마운트 때만 반영) → `value`(React가 서버 prop과 항상 동기화). 뒤로/앞으로 이동으로 URL이 바뀌면 서버가 새 prop을 내려주고 표시가 즉시 따라옴 = 표시=실제결과 보장. onChange(router.push)는 그대로라 앞으로 이동 동작 무변경. **가장 표준적·저위험 수정.**
- **②-(a) 조회 기간 명시**: 결과 헤더에 "신청 기간 YYYY-MM-DD ~ YYYY-MM-DD"(또는 "전체 기간")를 항상 표기 → '조용히'가 사라짐(감사자가 지금 무슨 기간을 보는지 명확).
- **②-(b) "전체 기간" 버튼**: 필터바에 버튼 추가. 누르면 URL `all=1` → 서버가 from/to를 null로 넘김 → `listApprovalHistory`가 기간 필터를 안 걸어 전체 조회(상한 300건은 유지). 특정 범위로 돌아가려면 달력에서 날짜 적용.
- **RangeCalendar(공통) 무수정**: 표시가 이미 prop 기반이라 어긋남 없음. 공통 모듈 회귀 위험 회피.

## 2. 수정/생성 파일 목록
- `webapp/app/approval-history/page.tsx` (수정) — `all` 파라미터 파싱, allPeriod면 filter.from/to=null, 결과 헤더에 조회기간 라벨, Filters에 allPeriod prop 전달.
- `webapp/app/approval-history/ApprovalHistoryFilters.tsx` (수정) — select 3개 `defaultValue`→`value`, `build()`에 all 반영, "전체 기간" 버튼 추가, allPeriod prop 수신.
- (임시) `webapp/app/api/_hist-filter-check/route.ts` — build URL 조합·전체기간 null 처리 검증용, **검증 후 삭제**.
- **생성 없음(영구), DB/마이그레이션 없음.**

## 3. 🛡️ 사이드 이펙트 방어
- **영향받을 수 있는 기능 + 대응**:
  - 기존 URL 북마크(`?type=leave&from=...`): `all` 없음 → 기존과 동일하게 동작(기본 이번 달 or 지정 범위). **하위호환 유지**.
  - RangeCalendar 공통 컴포넌트: **호출 방식 무변경**(from/to/onApply 그대로). 다른 화면(내근태·휴가승인 등) 무영향.
  - `listApprovalHistory`: 시그니처·쿼리 무변경. null 입력은 기존 코드가 이미 처리(84~86행).
- **구현 후 반드시 테스트할 기존 기능**:
  1. 유형/상태/직원 필터 각각 선택 → 결과·URL 정상, 표시=선택값.
  2. 기간 달력 적용 → 해당 범위 조회, 헤더 기간 라벨 일치.
  3. "전체 기간" → 과거 포함 전체 조회, 헤더 "전체 기간".
  4. **뒤로가기/앞으로가기** → 드롭다운 3개 표시가 결과와 일치(핵심 회귀 검증).
  5. 초기화 버튼 → 기본 이번 달로 복귀.
  6. 비관리자·미인증 접근 차단(기존 redirect) 유지.

## 4. 작업분해 TODO (1개 = 독립 완성·확인 단위)
- [ ] 1단계: `ApprovalHistoryFilters.tsx` — select 3개 `defaultValue`→`value` 제어형 전환 — 파일: 위 경로
- [ ] 2단계: `ApprovalHistoryFilters.tsx` — `allPeriod` prop 수신 + `build()`에 all 반영 + "전체 기간" 버튼 추가
- [ ] 3단계: `page.tsx` — `all` 파라미터 파싱 → allPeriod면 filter.from/to=null, Filters에 allPeriod 전달
- [ ] 4단계: `page.tsx` — 결과 헤더에 "조회 기간(신청일 기준)" 라벨 추가(전체면 "전체 기간")
- [ ] 5단계: 임시 라우트로 build URL 조합·전체기간 null 검증 → 삭제
- [ ] 6단계: tsc·eslint 0 확인 + 3001 서버 실화면(뒤로가기 표시 일치·전체기간·초기화) 검증
- [ ] 7단계: 영향받는 기존 기능 테스트(§3 목록)
- [ ] 8단계: code-reviewer 검수 + project-status.md 갱신 + 커밋

## 5. 핵심 로직 샘플 (계획용 스니펫, 실제 구현 아님)
```tsx
// ApprovalHistoryFilters.tsx — 제어형 + all 반영
const build = (over) => {
  const v = { type, status, userId, from, to, all: allPeriod, ...over };
  const q = new URLSearchParams();
  if (v.type !== "all") q.set("type", v.type);
  if (v.status !== "all") q.set("status", v.status);
  if (v.userId !== "all") q.set("userId", v.userId);
  if (v.all) q.set("all", "1");           // 전체기간이면 기간 파라미터 생략
  else { if (v.from) q.set("from", v.from); if (v.to) q.set("to", v.to); }
  return `/approval-history${q.toString() ? `?${q}` : ""}`;
};
<select value={type} onChange={(e)=>router.push(build({ type:e.target.value }))} .../>
// "전체 기간" 버튼: onClick={()=>router.push(build({ all:true }))}
// 달력 적용: onApply={(f,t)=>router.push(build({ from:f, to:t, all:false }))}
```
```tsx
// page.tsx
const allPeriod = sp.all === "1";
const filter = { ..., from: allPeriod ? null : new Date(fromISO+...), to: allPeriod ? null : new Date(toISO+...) };
// 헤더: allPeriod ? "전체 기간" : `${fromISO} ~ ${toISO}`
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- RangeCalendar 공통 컴포넌트 수정(불필요·회귀위험).
- 다른 화면(외출승인 등)의 기본기간: 운영 화면(대기건)이라 이번 달 기본이 적절 → **보고만, 미수정**.
- 페이징/무한스크롤(상한 300 유지, 이번 범위 밖).
- DB 인덱스(@@index) 추가(별도 성능 과제로 기존 기록됨).

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
