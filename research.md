# Research: B-1 조퇴(早退) 판정 신설 (2026-07-18)

## 무엇을 만드나 (한 줄)
지각(출근 기준시각보다 늦음)과 **대칭으로**, **퇴근 기준시각(workEndTime)보다 일찍 퇴근하면 "조퇴"로 판정·표시**한다. 현재 조퇴 판정은 전혀 없음.

## 핵심 발견
- **`workEndTime`(퇴근 기준시각 "HH:MM")은 이미 존재**: schema.prisma:36, [설정→근무제·기준시간]에서 저장(settings.ts:150·176), 폼에도 시/분 드롭다운 있음(WorkRulesForm). **그런데 어떤 판정에도 안 쓰임(휴면 필드).** → 조퇴 판정에 그대로 사용 → **DB 변경·마이그레이션 없음(서버 안 꺼도 됨).**
- 지각 판정 = 순수함수 `isLate(clockIn, workStartTime, graceMin)`(worktime.ts:33). null=회사 미설정 시 판정 안 함.

## 관련 파일과 역할 (지각이 있는 모든 곳 = 조퇴 대칭 대상)
- **lib/worktime.ts** `isLate`(33) — 여기에 대칭 `isEarlyLeave(clockOut, workEndTime)` **신규 추가**(무수정, 함수만 추가).
- **lib/dayentries.ts `buildDayEntries`**(공용 계산) — `DayEntry.att`에 `late`(27)·집계 `lateCount`(86)·`hasRule`(54)를 만든다. → `early`·`earlyLeaveCount`·`hasEndRule` **추가**(기존 필드 무수정).
- **app/components/DetailTable.tsx** — DayEntry를 받아 KPI "지각"(83)·표 "지각" 열(111·163~166) 표시. → 조퇴 KPI·열 추가.
- **app/components/MonthCalendar.tsx** — DayEntry로 달력 뱃지 "지각"(62·104). → 조퇴 뱃지 추가.
- **app/records/page.tsx**(전체 근태현황, 관리자) — `isLate` 직접 사용(83)해 `late`·`lateText`(92) 만들어 RecordsClient에 넘김. → `early` 추가.
- **app/records/RecordsClient.tsx** — KPI "지각"(68)·표 "지각" 열(109·144~149). → 조퇴 추가 + props 타입.
- **app/dashboard/page.tsx** — 오늘 알림에 지각 명단(72·209~211). → (선택) 오늘 조퇴 명단 추가.
- **app/settings/WorkRulesForm.tsx** — 안내문구 "기준시각+유예 이후 출근=지각"(44) → 조퇴 문구 보완(카피만).

## 🔴 영향 범위 / 공용 모듈 (safe-coding 대상)
- **공용 모듈 2개 수정**: `worktime.ts`(함수 추가만), `dayentries.ts`(필드 추가만). **기존 `isLate`·`late`·`lateCount` 무수정** → 지각 로직 회귀 위험 격리.
- **`buildDayEntries` 소비처 = DetailTable·MonthCalendar 뿐**(grep 전수: my-records·records/[userId]가 buildDayEntries 호출→이 둘에 전달). 새 필드는 **옵셔널 추가**라 기존 소비처가 안 읽어도 안 깨짐(TS union에 필드 추가는 기존 구조분해 무영향).
- `DayEntry`/`DayDetail` 타입을 읽는 다른 곳 없음(이 둘 외 소비처 없음 확인).

## DB·API 변경 여부, 위험 요소
- **DB 변경 없음**(workEndTime 재사용). 마이그레이션·서버끄기 없음.
- **판정 방식(결정 필요)**: `isEarlyLeave`에 유예를 둘까?
  - (A, 추천) **유예 없음**: 퇴근시각(time-of-day) < workEndTime 이면 조퇴. 단순·명확, 새 필드 없음.
  - (B) `lateGraceMin` 재사용: workEndTime - grace 보다 일찍이면 조퇴. 단 lateGraceMin은 의미상 "출근 유예"라 혼동 우려.
  - (C) 조퇴 전용 유예 필드 신설 → 스키마 변경(마이그레이션) → 범위 커짐. 지금은 제외 권장.
- **오버나이트(야간근무) 한계**: `isLate`가 이미 시:분(time-of-day)만 비교해 자정 넘김을 판정 못 하는 한계가 있고, `isEarlyLeave`도 **동일하게 미러링**한다(02시 퇴근을 조퇴로 오판 가능). 제품이 사무직(주간) 대상이라 기존 지각과 같은 수준의 한계 수용. 화면/문구에 명시.
- 조퇴는 **근무일 + clockOut 존재 + workEndTime 설정** 시에만. 휴일(휴일근무)·미퇴근(근무중)·미설정은 null(판정 안 함) — 지각과 동일 게이팅.

## 결론 (계획 시 고려사항)
1. `isEarlyLeave` 순수함수 신설(isLate와 대칭, 유예는 (A) 없음 권장).
2. `buildDayEntries`에 `early`/`earlyLeaveCount`/`hasEndRule` 추가(기존 무수정).
3. 표시 4곳 대칭 반영: DetailTable·MonthCalendar(공용경로) + records/page+RecordsClient(전체현황) + (선택)dashboard + 설정 문구.
4. DB·마이그레이션 없음 → 서버 재시작 불필요.
5. 지각과 동일 게이팅(근무일·clockOut有·기준시각有)으로 오판 최소화.
