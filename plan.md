# Plan: 조퇴·반차 신청→승인→근태 자동반영 (2026-07-18) — 상태: 검토 대기

## 1. 접근 방식 (+이유)
기존 "휴가 신청→관리자 승인" 흐름에 **새 종류(오전반차·오후반차·조퇴)를 얹고**, 승인된 날은 그날 출퇴근의 지각·조퇴 판정을 **면제하고 승인 뱃지로 표기**한다.
- 이유: ①`LeaveRequest.type`이 자유 문자열 → **스키마 변경/마이그레이션 없음** ②신청·승인 인프라 재사용 ③내가 만든 자동 조퇴감지는 유지 → "승인 조퇴 vs 무단 조퇴" 구분 완성.
- 결정 반영: 조퇴=연차 차감0 / 반차=오전·오후 구분 / 신청=기존 [휴가] 메뉴.

## 2. 수정/생성 파일 (스키마 무변경 · 마이그레이션 없음)
| # | 파일 | 변경 |
|---|---|---|
| 1 | lib/leave.ts | 종류 3개 추가(half_am·half_pm·early_leave), 신청가능목록·단일일목록, computeLeaveDays(조퇴=0), `leaveTypeByDate`·`suppressesLate/Early` 헬퍼 |
| 2 | app/actions/leave.ts `requestLeave` | 단일일 종류 확장 + 조퇴(days=0) 거부 예외 + 종류검증 |
| 3 | app/leave/LeaveRequestForm.tsx | 드롭다운 신청가능목록·singleDay 확장 |
| 4 | lib/dayentries.ts | att엔트리: 승인 반차/조퇴면 지각·조퇴 면제 + `approvedLeave` 필드. 새 인자 leaveTypeByDate(옵셔널) |
| 5 | app/my-records/page.tsx · records/[userId]/page.tsx | buildDayEntries에 leaveTypeByDate 전달 |
| 6 | app/components/DetailTable.tsx · MonthCalendar.tsx | "지각/조퇴" 자리에 승인 반차/조퇴 뱃지(파랑) |
| 7 | app/records/page.tsx · RecordsClient.tsx | 직원별 승인휴가맵으로 지각·조퇴 면제 + 뱃지 |
| 8 | app/dashboard/page.tsx | 오늘 지각·조퇴 집계에서 승인자 제외 |

## 3. 🛡️ 사이드 이펙트 방어
- **면제는 "승인된" 것만**: 승인 없는 진짜 조퇴/지각은 그대로 잡힘(기능 유지). status=approved만 반영.
- **자동감지 무수정**: isLate·isEarlyLeave 그대로. 면제는 판정 뒤 덮어쓰기(null).
- **호출부 옵셔널 인자**: leaveTypeByDate 기본 빈 맵 → 안 넘긴 곳은 기존 동작(회귀 안전).
- **연차 차감 정확성**: 오전/오후 반차=0.5 차감·조퇴=0. `usedLeaveDays`/연차정산 회귀 실검증.
- **레거시 `half` 호환**: 과거 반차 신청은 라벨 표시 유지, 면제 시 지각·조퇴 둘 다 면제.
- **구현 후 반드시 테스트할 기존 기능**:
  1. 연차/병가 신청·승인·결근제외·연차정산 **회귀 없음**
  2. 오전 반차 승인 → 그날 늦게 출근해도 **지각 아님**, "오전 반차" 표기
  3. 오후 반차/조퇴 승인 → 일찍 퇴근해도 **조퇴 아님**, "오후 반차"/"조퇴" 표기
  4. 승인 없이 일찍 퇴근 → 여전히 **"조퇴"(무단)** 로 잡힘
  5. 조퇴 신청 → 연차 잔여 **안 줄어듦**, 반차 신청 → 0.5 줄어듦
  6. 미래 날짜 신청(사전예약) → 승인 → 그날 반영
  7. 대시보드 오늘 지각·조퇴 수에서 승인자 제외

## 4. 작업분해 TODO (3덩어리로 커밋)
**A. 신청·승인 (종류 추가)**
- [ ] 1: lib/leave.ts 종류·차감·단일일·헬퍼
- [ ] 2: actions/leave.ts requestLeave 확장(조퇴 days=0 예외)
- [ ] 3: LeaveRequestForm 드롭다운·singleDay
- [ ] 4: 신청·승인·연차정산 실검증(DB)

**B. 근태 반영(공용 경로: 근태상세·달력)**
- [ ] 5: dayentries.ts 면제+approvedLeave
- [ ] 6: my-records·records/[userId] 인자 전달
- [ ] 7: DetailTable·MonthCalendar 뱃지
- [ ] 8: 실검증(오전/오후/조퇴/무단)

**C. 전체현황·대시보드 반영**
- [ ] 9: records/page+RecordsClient 직원별 면제·뱃지
- [ ] 10: dashboard 오늘 집계 제외
- [ ] 11: tsc+eslint 0, npm run build(전 페이지), code-reviewer, 문서갱신

## 5. 핵심 로직 샘플 (계획용, 실제 구현 아님)
```ts
// lib/leave.ts
export const LEAVE_TYPES = [
  { key:"annual",     label:"연차",      deducts:true  },
  { key:"half_am",    label:"오전 반차", deducts:true  }, // 0.5 차감, 지각 면제
  { key:"half_pm",    label:"오후 반차", deducts:true  }, // 0.5 차감, 조퇴 면제
  { key:"early_leave",label:"조퇴",      deducts:false }, // 차감 없음, 조퇴 면제
  { key:"sick",       label:"병가",      deducts:false },
  { key:"half",       label:"반차",      deducts:true  }, // 레거시(과거 데이터 라벨용)
];
export const REQUESTABLE_TYPES = ["annual","half_am","half_pm","early_leave","sick"]; // 드롭다운
export function computeLeaveDays(type, ...) { if(type==="early_leave") return 0; if(type.startsWith("half")) return 0.5; ... }
export function suppressesLate(type){ return ["half_am","half","annual","sick"].includes(type); }
export function suppressesEarly(type){ return ["half_pm","early_leave","half","annual","sick"].includes(type); }
export function leaveTypeByDate(approved){ /* date(ISO)→type key 맵 */ }

// lib/dayentries.ts (att 계산)
const lt = leaveTypeByDate.get(iso);        // 그날 승인된 휴가 종류
let late  = onWorkDay ? isLate(...)  : null;
let early = onWorkDay ? isEarlyLeave(...) : null;
if (lt && suppressesLate(lt))  late  = null; // 승인 → 지각 면제
if (lt && suppressesEarly(lt)) early = null; // 승인 → 조퇴 면제
const approvedLeave = lt ? leaveTypeLabel(lt) : null; // 뱃지용
```
표시: "지각/조퇴" 칸 = 휴일근무 > 승인뱃지(파랑, 예 "오후 반차") > 지각·조퇴(주황) > 정상.

## 6. 구현하지 않을 것 (범위 제외)
- 조퇴 "예정 시각" 입력(사장님 모델=날짜만) · 반차 시간단위 · 결재선 다단계 · 조퇴 알림.
- 자동감지 삭제(무단 조퇴 잡기 위해 유지).
- 기존 `half` 데이터의 오전/오후 소급 분류(그대로 둠).

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- 한 번에 다(A+B+C) 갈까요, A(신청)부터 단계별로 볼까요?:
-
