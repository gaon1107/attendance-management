# Plan: B-1 조퇴(早退) 판정 신설 (2026-07-18) — 상태: 검토 대기

## 1. 접근 방식 (+이유)
지각(`isLate`)과 **완전 대칭**으로 조퇴 판정을 신설한다. 이미 있는 휴면 필드 `workEndTime`(퇴근 기준시각)을 사용한다.
- 이유: ①검증된 지각 로직을 그대로 미러링 → 위험 최소 ②`workEndTime` 재사용 → **DB 변경·마이그레이션 없음(서버끄기 불필요)** ③공용 모듈은 "추가만" 해 지각 회귀 격리.
- 판정 규칙(추천 A): **퇴근시각(time-of-day) < workEndTime 이면 조퇴**(유예 없음). 근무일 + 퇴근기록 존재 + workEndTime 설정 시에만.

## 2. 수정/생성 파일 목록 (스키마 무변경)
| # | 파일 | 변경 |
|---|---|---|
| 1 | lib/worktime.ts | `isEarlyLeave(clockOut, workEndTime)` **함수 추가**(isLate 무수정) |
| 2 | lib/dayentries.ts | DayEntry.att에 `early`, DayDetail에 `earlyLeaveCount`·`hasEndRule` **추가**(기존 무수정) |
| 3 | app/components/DetailTable.tsx | KPI "조퇴" + 표 "조퇴" 표시(지각과 나란히) |
| 4 | app/components/MonthCalendar.tsx | 달력 "조퇴" 뱃지 + 범례 |
| 5 | app/records/page.tsx | `early` 계산해 RecordsClient에 전달 |
| 6 | app/records/RecordsClient.tsx | KPI "조퇴" + 표 "조퇴" + props 타입 |
| 7 | app/dashboard/page.tsx | (선택) 오늘 "조퇴" 명단 1줄 |
| 8 | app/settings/WorkRulesForm.tsx | 안내문구에 조퇴 설명 보완(카피만) |

## 3. 🛡️ 사이드 이펙트 방어
- **공용 모듈 추가만**: `isLate`·`late`·`lateCount`·`hasRule` 전부 무수정 → 지각/실근무 판정 회귀 없음. 새 필드는 옵셔널 추가라 기존 소비처(DetailTable·MonthCalendar) 구조분해에 무영향.
- **동일 게이팅**: 조퇴는 지각과 똑같이 `onWorkDay && clockOut && workEndTime` 일 때만. 휴일근무·근무중(미퇴근)·미설정은 조퇴 아님(null).
- **workEndTime 없는 회사**: `hasEndRule=false` → 조퇴 KPI "—"·뱃지 없음(기존 지각 미설정과 동일 UX). 기존 회사 영향 0.
- **구현 후 반드시 테스트할 기존 기능**:
  1. 지각 판정·지각 건수·달력 지각 뱃지 **그대로**(회귀 없음)
  2. 실근무시간(workedMinutes)·결근·휴가 집계 그대로
  3. workEndTime 설정 회사: 일찍 퇴근 → 조퇴 표시 / 정시 이후 → 조퇴 아님
  4. workEndTime 미설정 회사: 조퇴 "—"(판정 안 함)
  5. 휴일근무·근무중(미퇴근) → 조퇴 아님
  6. 한 기록이 지각+조퇴 동시(늦게 와서 일찍 감) → 둘 다 표시

## 4. 작업분해 TODO
- [ ] 1단계: `isEarlyLeave` 순수함수 + `buildDayEntries` 필드 추가(공용 2파일)
- [ ] 2단계: DetailTable(KPI+표) 조퇴 표시
- [ ] 3단계: MonthCalendar 조퇴 뱃지+범례
- [ ] 4단계: records/page + RecordsClient 조퇴(전체 근태현황)
- [ ] 5단계: (선택) dashboard 오늘 조퇴 명단 + WorkRulesForm 문구
- [ ] 6단계: tsc + eslint 0
- [ ] 7단계: 실DB로 6종 시나리오 검증(순수함수 단위 + 실기록)
- [ ] 8단계: code-reviewer 검수 + 치명·중간 반영
- [ ] 9단계: git 커밋 + 문서 갱신

## 5. 핵심 로직 샘플 (계획용, 실제 구현 아님)
```ts
// worktime.ts (isLate와 대칭 추가)
// 조퇴 여부 — 회사가 정한 퇴근 기준시각보다 일찍 퇴근이면 조퇴.
// clockOut 없음(근무중) 또는 기준시각 미설정이면 null(판정 안 함). isLate와 동일하게 시:분만 비교.
export function isEarlyLeave(clockOut: Date | null, workEndTime: string | null): boolean | null {
  if (!clockOut || !workEndTime) return null;
  const [h, m] = workEndTime.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const limit = h * 60 + m;
  const outMinutes = clockOut.getHours() * 60 + clockOut.getMinutes();
  return outMinutes < limit;
}

// dayentries.ts (Company 타입에 workEndTime 추가, 계산 추가)
const early = onWorkDay ? isEarlyLeave(r.clockOut, company?.workEndTime ?? null) : null;
// ...att entry에 early 포함
const earlyLeaveCount = attEntries.filter((e) => e.type === "att" && e.early === true).length;
const hasEndRule = !!company?.workEndTime;
```
표시: 지각 뱃지 옆에 동일 스타일 "조퇴"(색만 구분). KPI에 "조퇴 N건". 한 줄에 지각·조퇴 동시 가능.

## 6. 구현하지 않을 것 (범위 제외)
- **조퇴 전용 유예 필드**(스키마 변경) — 지금은 유예 없음(A안). 필요 시 추후.
- **야간근무 자정넘김 정확판정** — isLate와 동일한 기존 한계 수용(사무직 대상).
- **조퇴 사유 입력·결재** — 별도 기능(범위 밖).

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- 조퇴 유예: (A)없음 / (B)지각유예 재사용 → 선택:
- dashboard 오늘 조퇴 명단도 넣을까요? (예/아니오):
-
