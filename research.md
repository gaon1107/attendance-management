# Research: 조퇴·반차 신청→승인→근태 자동반영 (2026-07-18)

## 사장님 확정 모델
```
직원이 [휴가] 메뉴에서 신청(날짜 지정, 미래 예약 가능) → 관리자 승인
→ 그 날짜에 직원이 출퇴근하면 자동으로 "반차/조퇴(승인)"로 처리(지각·조퇴 오탐 없이 이력 표기)
```
- 조퇴 = 연차 **차감 안 함** / 반차 = **오전·오후 구분**(오전=지각면제, 오후=조퇴면제) / 신청 = **기존 [휴가] 메뉴 통합**.

## 핵심 발견 (좋은 소식)
- **`LeaveRequest.type`은 자유 문자열**(schema.prisma:240) → 새 종류(`half_am`·`half_pm`·`early_leave`)를 **값만 추가**하면 됨. **스키마 변경/마이그레이션/서버끄기 전부 불필요.**
- **신청·승인 인프라 이미 완비**: 직원 신청 `requestLeave`([actions/leave.ts](webapp/app/actions/leave.ts):11) / 관리자 승인 `approveLeave`(:74)·반려(:86). 승인 로직은 종류 무관 = 새 종류 그대로 승인됨.
- **승인 휴가→날짜 펼치기**도 이미 있음: `leaveLabelByDate`(date→라벨), `leaveDateSet`(결근 제외용). ([lib/leave.ts](webapp/lib/leave.ts):72·87)
- 종류 정의는 `LEAVE_TYPES`([lib/leave.ts](webapp/lib/leave.ts):6) 한 곳에서 label·deducts를 관리 → 신청폼·라벨·차감이 여기서 파생.

## 지금 끊긴 지점 (이번에 이을 곳)
1. **종류에 오전/오후 반차·조퇴가 없음** — `half`(반차 0.5) 하나뿐, 조퇴 없음.
2. **승인된 반차/조퇴가 그날 출퇴근의 지각·조퇴 판정과 연결 안 됨** — `buildDayEntries`는 leaveByDate를 **결근 아닌 날 표시**에만 쓰고, **출근한 날의 지각/조퇴 판정엔 안 씀**. 그래서 오후 반차로 일찍 가도 "조퇴"로 오탐(내가 방금 만든 자동감지가 승인을 모름).

## 관련 파일과 역할
- **lib/leave.ts** — `LEAVE_TYPES`(종류·차감), `computeLeaveDays`(반차=0.5), `leaveLabelByDate`. → 새 종류 3개 + `computeLeaveDays`에 조퇴=0 + `leaveTypeByDate`(date→종류key) 헬퍼 추가.
- **app/actions/leave.ts `requestLeave`** — 종류 검증·단일일 처리(현재 half/sick만 단일일, :26)·`days<=0` 거부(:40). → 새 단일일 종류 추가, 조퇴(days=0) 거부 예외.
- **app/leave/LeaveRequestForm.tsx** — 종류 드롭다운(LEAVE_TYPES 그대로 렌더)·`singleDay=half||sick`(:17). → 새 종류가 드롭다운에 자동 노출, singleDay 목록 확장.
- **lib/dayentries.ts `buildDayEntries`** — 출근한 날 att엔트리에 late/early 계산(:57~). → 그날 **승인 반차/조퇴가 있으면 지각/조퇴를 면제(null)하고 승인 뱃지**를 붙임. `DayEntry.att`에 `approvedLeave` 추가. **호출부(my-records·records/[userId])에서 승인휴가 종류맵을 넘겨야 함.**
- **표시**: DetailTable·MonthCalendar(공용경로) / records/page+RecordsClient(전체현황) / dashboard(오늘) — "지각/조퇴" 자리에 승인 반차/조퇴 뱃지, 자동 오탐 제거.
- **승인 화면**(leave/approvals) — 종류 라벨만 새로 뜨면 됨(leaveTypeLabel이 처리). 로직 무수정.

## 🔴 영향 범위 / 공용 모듈 (safe-coding 대상)
- **공용 모듈 수정**: `lib/leave.ts`(추가 위주), `lib/dayentries.ts`(late/early에 면제 로직·필드 추가). 기존 `isLate/isEarlyLeave/leaveDateSet/usedLeaveDays`는 무수정.
- **`buildDayEntries` 호출부 2곳**(my-records·records/[userId])에 "승인 반차/조퇴 종류맵" 인자 전달 필요 → 안 넘기면 기본 빈 맵으로 기존 동작(회귀 안전).
- **`computeLeaveDays`·`LEAVE_TYPES` 소비처 전수**: 신청폼·연차정산(leave-summary)·usedLeaveDays. 새 종류의 deducts를 정확히(오전/오후 반차=0.5 차감, 조퇴=0) 넣어야 연차정산이 안 틀어짐 → 검증 필수.
- 자동감지(내가 만든 isEarlyLeave)는 **유지**하되, 승인이 있으면 그 위에서 면제 → "무단 조퇴 vs 승인 조퇴" 구분 완성.

## DB·API 변경 여부, 위험 요소
- **DB 스키마 변경 없음**(type 문자열 재사용) → 마이그레이션·서버끄기 없음.
- **기존 `half` 데이터 호환**: 과거 "반차"(half) 신청은 그대로 라벨 표시. 신규는 오전/오후로 신청. `half`도 면제 로직에선 "지각·조퇴 둘 다 면제"로 처리(안전).
- **연차 차감 정확성**(위험1): 오전/오후 반차=0.5 차감, 조퇴=0. 연차정산·잔여계산이 새 종류를 정확히 반영하는지 실검증 필요.
- **여러 기록/중복 날**(위험2): 하루 여러 출퇴근·같은 날 여러 승인 → 종류맵 병합 규칙 명확화(승인 반차가 있으면 그날 전체 면제).
- **자동감지 오탐 완전제거 여부**(위험3): 승인 없는 진짜 조퇴는 여전히 "조퇴"로 잡혀야 함(그게 기능). 승인 있는 것만 면제.

## 결론 (계획 시 고려사항)
1. 스키마 무변경 — 새 type 값 3개 + LEAVE_TYPES 확장 + 조퇴 차감0.
2. 신청·승인은 기존 흐름 재사용(폼 드롭다운·단일일 처리만 확장).
3. 핵심 = `buildDayEntries` 등 판정부에 "승인 반차/조퇴면 지각·조퇴 면제 + 승인뱃지" 배선. 자동감지는 유지(무단 조퇴 잡기).
4. 표시 4경로(DetailTable·MonthCalendar·records·dashboard) 대칭 반영.
5. 연차정산 회귀 없는지(차감값) 실검증 필수.
6. 규모 중간~큼(약 8~10파일) — 논리적 단위로 나눠 커밋.
