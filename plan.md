# Plan: 초과근무 관리화면 + 휴게시간 관리화면 — 2026-07-23 — 상태: 검토 대기

> 사장님 결정 반영: ①휴게 = **표시만**(실근무 계산 무접촉) ②초과근무 = **조회 전용**(정산 기능 없음) ③초과근무 기준 = **주 40시간 초과**(법정 연장근로).
> 두 화면 모두 **읽기 전용 + 설정 저장**만 하므로 기존 계산·판정 코드는 건드리지 않는다.

---

## 1. 접근 방식 (+이유)

### A. 초과근무 관리화면 (관리자 [초과근무관리])
주 단위로 **직원별 연장근로**를 모아 보는 조회 화면. 계산은 기존 부품 재사용:
- 주간 실근무 = `workedMinutes` + `cappedEnd`(퇴근 안 누른 기록이 며칠씩 부풀지 않게 막는 기존 안전장치) — [lib/overtime.ts](webapp/lib/overtime.ts)·[lib/worktime.ts](webapp/lib/worktime.ts) 그대로
- **기본근무 = 주간 실근무 중 40시간까지 / 연장근로 = 40시간 초과분 / 한도 = 주 12시간**
- 화면 상단에 **"이 화면의 계산 기준"을 한 줄로 명시** → [리포트] 화면의 초과근무(하루 8시간 초과분 합)와 숫자가 달라 보이는 혼선 차단

### B. 휴게시간 관리화면 (관리자 [휴게시간])
회사가 **최소 휴게 기준**을 정하고, 그날 직원들이 그만큼 쉬었는지 **점검만** 하는 화면.
- 휴게시간 = 지금처럼 **직원의 [외출]~[복귀] 기록 합계**(별도 개념 안 만듦)
- 근무 4시간 초과 → 최소 30분 / 8시간 초과 → 최소 60분(법정 기본값, 회사가 더 넉넉히 조정 가능)
- **`worktime.ts`는 한 글자도 안 건드린다** → 근무시간 숫자 변화 0

## 2. 수정/생성 파일 목록

**생성 6개**
- `webapp/lib/overtime-week.ts` — 주간 연장근로 순수함수(`splitWeeklyWork`, `extraLevel`)
- `webapp/app/overtime-manage/page.tsx` — 초과근무 관리(서버 컴포넌트: 주 선택·집계)
- `webapp/app/overtime-manage/OvertimeManageClient.tsx` — 필터(부서·검색)+표+페이징
- `webapp/lib/break-rule.ts` — 필요 휴게시간·준수 판정 순수함수
- `webapp/app/break-time/page.tsx` — 휴게시간 관리(설정 카드 + 그날 준수 현황)
- `webapp/app/break-time/BreakRuleForm.tsx` — 휴게 기준 설정 폼

**수정 4개**
- `webapp/prisma/schema.prisma` — `Company`에 **add-only 3칸**: `breakCheckOn Boolean @default(true)`, `breakMin4h Int @default(30)`, `breakMin8h Int @default(60)` (+마이그레이션)
- `webapp/app/actions/settings.ts` — `saveBreakRule` 서버액션 **추가**(기존 액션 무수정)
- `webapp/app/components/Sidebar.tsx` — NavKey·LABEL·ICON·관리자 메뉴 배열에 2개 **추가만**
- `webapp/lib/overtime.ts` — **상수 2개만 추가**(`WEEKLY_REGULAR_MIN`=40h, `WEEKLY_EXTRA_LIMIT_MIN`=12h). 기존 함수·값 **무수정**

## 3. 🛡️ 사이드 이펙트 방어

- **`lib/worktime.ts`(실근무 계산) 무접촉** — 이번 작업의 최우선 불변식. 근태현황·직원상세·리포트·엑셀 법정기록·대시보드·주52 판정 숫자 전부 그대로.
- **`lib/overtime.ts`는 add-only** — `weeklyLevel`·`cappedEnd`·`weekStartMonday`는 대시보드 주52 알림이 쓰는 공통 부품이라 **수정하지 않고 상수만 추가**한다. (safe-coding: 공통 모듈은 더하기만)
- **기존 [리포트] 화면 무수정** — 초과근무 열도 그대로 둔다(정의가 다르므로 새 화면에 기준 명시로 해결).
- **Sidebar는 공통 부품** — 배열·맵에 항목 추가만. 기존 키 이름·순서·조건부 노출(showApprovals) 로직 무수정. 관리자에게만 노출, 직원 메뉴 무변경.
- **DB는 add-only 3칸(기본값 있음)** — 기존 회사는 법정 기본값(30/60·점검 켬)으로 자동 동작, 마이그레이션 후 기존 데이터 무영향.
- **구현 후 반드시 테스트할 기존 기능**:
  1. [리포트] 실근무·초과근무 숫자가 작업 전과 동일
  2. 대시보드 주 52시간 알림(정상/근접/초과) 동일
  3. 직원별 근태상세·근태현황의 근무시간 동일
  4. 엑셀 내보내기 값 동일
  5. 사이드바 기존 메뉴 전부 정상(관리자/직원 각각), [결재함] 조건부 노출 동작
  6. 직원 [출퇴근] 외출/복귀 정상

## 4. 작업분해 TODO
- [ ] 1단계: `lib/overtime-week.ts` + `lib/overtime.ts` 상수 추가 → 임시 라우트로 순수함수 검증
- [ ] 2단계: `/overtime-manage` 화면(주 이동·부서 필터·검색·페이징·KPI·기준 안내)
- [ ] 3단계: Sidebar 메뉴 추가(초과근무관리)
- [ ] 4단계: 스키마 3칸 + 마이그레이션(서버 끄고)
- [ ] 5단계: `lib/break-rule.ts` + `saveBreakRule` 액션
- [ ] 6단계: `/break-time` 화면(설정 카드 + 준수 현황 표) + Sidebar 메뉴 추가
- [ ] 7단계: 임시 라우트로 판정·집계 검증(실DB 라운드트립 포함) → **라우트 삭제**
- [ ] 8단계: 회귀 확인(위 6개) + 3001 실화면
- [ ] 9단계: code-reviewer 검수 → 커밋(코드/문서 분리) → project-status.md 갱신

## 5. 핵심 로직 샘플 (계획용 — 실제 구현 아님)
```ts
// lib/overtime-week.ts — 주간 실근무를 "기본근무 / 연장근로"로 나눈다(근로기준법 주 40h 기준).
export function splitWeeklyWork(weekMinutes: number) {
  const base = Math.min(weekMinutes, WEEKLY_REGULAR_MIN);      // 40h까지
  const extra = Math.max(0, weekMinutes - WEEKLY_REGULAR_MIN); // 40h 초과분 = 연장
  return { base, extra, ratio: extra / WEEKLY_EXTRA_LIMIT_MIN }; // 한도(12h) 대비
}

// lib/break-rule.ts — 그날 근무시간에 대해 "최소 몇 분 쉬어야 하는가".
export function requiredBreakMinutes(workedMin: number, rule: BreakRule): number {
  if (workedMin > 8 * 60) return rule.min8h;   // 8시간 초과 → 1시간
  if (workedMin > 4 * 60) return rule.min4h;   // 4시간 초과 → 30분
  return 0;
}
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- **점심 자동 차감**(고정 시간 차감) — 사장님 결정으로 제외. 실근무 계산·법정기록·급여에 파급.
- **초과근무 정산/승인 처리** — 사장님 결정으로 제외(조회 전용).
- **엑셀 내보내기**(목업의 "내보내기" 버튼) — 이번 범위 밖. 필요하면 기존 `reports/export` 패턴으로 별도 추가.
- **기존 [리포트]의 초과근무 정의 변경** — 회귀 위험. 두 기준을 각 화면에 명시하는 것으로 대신함.
- **부서별 소계·그래프**, 휴게 미준수 알림 발송 — 다음 단계 후보.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
