# Plan: 공휴일·회사휴무일 반영 (2026-07-17) — 상태: 검토 대기

## 1. 접근 방식 (+이유)
"근무일이냐"를 판단하는 순수함수 `isWorkDay`(요일만 봄)는 **그대로 두고**, 그 위에
"이 날은 쉬는 날(휴일)인가"를 **합성**하는 새 판정을 추가한다.

```
실질 근무일 = isWorkDay(요일) AND (그 날짜가 휴일 목록에 없음)
```

휴일 목록 = **(A) 자동 공휴일**(정부 API로 1회 수집→DB 저장) + **(B) 회사 수동 휴무일**.
회사가 (A)를 **끄면** 자동 공휴일은 목록에서 빠지고, (B)는 토글과 무관하게 항상 적용.

- 이유: 6곳이 호출하는 공통함수 `isWorkDay`의 시그니처를 안 건드려 회귀 위험을 격리. 각 화면은 "휴일 날짜 집합(Set)"만 추가로 읽어 판정에 넘긴다.
- 사장님 아이디어 반영: API는 **매번 안 부르고** 서버 DB에 저장해두고 화면은 저장분을 뿌린다(장애 무관·빠름).

## 2. 수정/생성 파일 목록

### 신규
- `prisma/schema.prisma` — 표 2개 + 회사 토글 1개 추가 (⚠️ 마이그레이션 = 서버 정지 필요)
  - `Holiday`(전국 공용 공휴일: date, name, year) — 전 회사가 공유(공휴일은 전국 동일)
  - `CompanyHoliday`(회사별 수동 휴무일: companyId, date, name)
  - `Company.holidayAutoOn Boolean @default(true)` — 자동 공휴일 반영 토글
- `lib/holidays.ts` — **순수 로직**: 휴일 날짜 Set 만들기 + `isEffectiveWorkDay(date, workDays, offDays)`
- `lib/holiday-sync.ts` — **정부 API 호출·저장**(서버 전용). 실패해도 기존 저장분 유지.
- `app/actions/holidays.ts` — 서버액션: 토글 저장 / 수동휴무일 추가·삭제 / "지금 갱신"
- `app/settings/HolidayForm.tsx` — 설정 화면 UI(토글 + 갱신버튼 + 수동휴무일 목록)
- `lib/holidays.test.ts` (또는 수동검증 스크립트) — 순수함수 단위 검증
- `.env` — `HOLIDAY_API_KEY`(공공데이터포털 인증키) 한 줄 추가 (키는 커밋 안 함)

### 수정 (휴일 Set을 읽어 판정에 넘김 — add-only 성격)
- `lib/workdays.ts` — `isEffectiveWorkDay` 추가(기존 `isWorkDay`·`effectiveWorkDays` 무수정)
- `lib/dayentries.ts` — `buildDayEntries(..., offDays=new Set())` 인자 추가. **기본 빈 Set = 기존 동작 그대로**
- `lib/leave.ts` — `countWorkdaysBetween/ computeLeaveDays(..., offDays=new Set())` 인자 추가(기본 빈 Set)
- `app/records/page.tsx` — 기간 휴일 조회→Set→판정
- `app/records/[userId]/page.tsx` · `app/my-records/page.tsx` — buildDayEntries에 Set 전달
- `app/dashboard/page.tsx` — 오늘 기준 휴일 반영(지각 카운트·미출근·휴일근무 표시)
- `app/reports/page.tsx` — 결근 계산에 휴일 반영
- `app/actions/leave.ts` — 휴가 신청 시 연차 차감일 계산에 휴일 반영
- `app/settings/page.tsx` — HolidayForm 배치 + 회사 토글·수동휴무일 조회

### 손대지 않는 것
- `isWorkDay`, `effectiveWorkDays`, `leaveDateSet`, `leaveLabelByDate` — 시그니처 유지
- 표시 컴포넌트(DetailTable·MonthCalendar·RecordsClient) — 상위에서 넘기는 `holiday` 플래그만 따라감(무수정)

## 3. 🛡️ 사이드 이펙트 방어
| 위험 | 대응 |
|---|---|
| 공통함수 시그니처 변경으로 6곳 붕괴 | `isWorkDay`는 무수정. 새 함수 `isEffectiveWorkDay`만 추가 |
| `buildDayEntries`/leave 함수에 인자 추가 → 기존 호출 깨짐 | **기본값 빈 Set** → 인자 안 넘기면 100% 기존 동작 |
| 자동 토글 기본 ON → 기존 회사 과거 기록 표시가 바뀜 | **의도된 변경**(공휴일 지각/결근이 사라짐 = 원하는 결과). 단 사장님께 "과거 표시도 소급 반영됨" 명시 |
| 과거에 저장된 연차 사용일수 | 기존 저장분은 **재계산 안 함**(그대로). 신규 휴가 신청부터 공휴일 반영 |
| API 키 없음/정부사이트 장애 | 갱신 버튼이 **친절한 오류만** 내고 기존 저장분 유지. 수동휴무일(B)은 항상 동작 |
| 휴일 데이터 아직 없음(빈 표) | 빈 Set = 오늘과 동일 동작(안전). 갱신하면 채워짐 |
| 공휴일 정상근무 업종 오탐 | 토글 OFF 시 자동공휴일 완전 제외 |
| SQLite 마이그레이션 EPERM | 사장님 3000 서버 끄고 진행(별도 게이트) |

### 구현 후 반드시 테스트할 기존 기능
1. 주말 출근 → 여전히 "휴일근무"로 뜨는지(회귀 없음)
2. 평일 정상 지각 → 여전히 "지각"으로 뜨는지
3. 과거 근무일 무기록 → 여전히 "결근"으로 집계되는지
4. 휴가 신청 사용일수 계산(공휴일 없는 구간) 동일한지
5. 대시보드 지각 수·미출근 수 동일한지

## 4. 작업분해 TODO
- [x] 1단계: `lib/holidays.ts` 순수 로직 + `isEffectiveWorkDay` — 완료(5케이스 검증·tsc 0·커밋)
- [x] 2단계: 판정부 배선(빈 Set 기본값) — dayentries·leave 완료(커밋). **동작 100% 동일 확인**
- [x] 3단계(게이트) 스키마 파일 수정 완료(prisma validate 통과) — ⏳ **마이그레이션 실행은 서버 정지 대기**
- [x] 4단계: `lib/holiday-server.ts` 정부 API 수집·저장(실패 안전) + `.env` 키 완료
- [x] 5단계: `app/actions/holidays.ts` + `HolidayForm.tsx` + settings 배치 완료
- [x] 6단계: 6개 화면 연결 완료(records·[userId]·my-records·dashboard·reports·actions/leave)
- [x] 게이트: 서버 정지 → generate + migrate(20260717030911_add_holidays) + tsc/eslint exit 0 완료
- [x] 7단계: 회귀 테스트 완료 — 내근태 실화면: 7/17 공휴일→휴일근무, 07-16/14 지각 유지, 07-15 결근 유지, 주말 휴일근무 유지
- [x] 8단계: code-reviewer 치명0·중간1(0건응답 삭제방어) 수정·재검증 + 문서 갱신 완료

## ✅ 완료 (2026-07-17) — 실데이터·실화면 검증
- 정부 API 실호출 성공(2026 22건·2027 24건, 대체공휴일 포함, 7/17 제헌절 포함)
- 내근태 화면에서 7/17 6건 전부 "휴일근무" 확인(지각 사라짐)
- 커밋: 순수로직(1~2단계) + 완성(3~8단계) 2건

## 5. 핵심 로직 샘플 (계획용 스니펫, 실제 구현 아님)
```ts
// lib/workdays.ts (추가)
export function isEffectiveWorkDay(date: Date, workDays: Set<number>, offDays: Set<string>): boolean {
  return isWorkDay(date, workDays) && !offDays.has(toISODate(date));
}

// 각 화면: 휴일 Set 구성
// offDays = (company.holidayAutoOn ? 전국공휴일ISO : 없음) ∪ 회사수동휴무일ISO
```
정부 API: 공공데이터포털 특일정보 `getRestDeInfo`(연/월별 공휴일). 응답의 `locdate`(YYYYMMDD)·`dateName`을 저장.
갱신 트리거: **[지금 갱신] 버튼**(핵심) + 화면 조회 시 없는 연도면 `after()`로 조용히 1회 보충(선택·베스트에포트).

## 6. 구현하지 않을 것 (범위 제외)
- 부서별/개인별 휴무일(회사 전체 공통만) — 필요해지면 2차
- "공휴일인데 우리는 근무" 반대 예외(그 업종은 토글 OFF로 해결)
- 과거 저장 연차의 소급 재계산(정합성·혼란 방지)
- 자동 스케줄러(cron) 상시 구동 — 버튼 + 지연보충으로 대체
- 휴일 이름을 화면에 새로 표기(현행 "휴일근무" 배지 유지)

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
</content>
