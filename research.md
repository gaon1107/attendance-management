# Research: B-2 연차 자동발생 (2026-07-18)

## 배경
현재 연차 "발생(부여)"은 관리자가 직원마다 숫자를 손으로 입력(`setAnnualLeave`)한다.
입사일(`hireDate`)은 저장·표시만 될 뿐 계산에 안 쓰인다.
→ 입사일 기준으로 근로기준법에 맞게 자동 부여로 바꾸는 것이 목표.

## 관련 파일과 역할
- `prisma/schema.prisma` User: `annualLeaveDays Float @default(15)`, `hireDate DateTime?`
- `lib/leave.ts` — 휴가 계산 순수함수 모음(`usedLeaveDays`, `usedLeaveDaysInYear`, `computeLeaveDays` 등). **공통 모듈**.
- `app/actions/leave.ts`:
  - `requestLeave`:48 — 잔여 = `me.annualLeaveDays - usedLeaveDays(mine)` (신청 시 초과 검사)
  - `setAnnualLeave`:98 — 관리자 수동 부여(직원상세 폼)
- `app/leave/page.tsx`:35,38 — 직원 본인 [휴가] 화면 "부여 연차 / 잔여"
- `app/employees/[id]/page.tsx`:60,178 — 직원 상세 "잔여" + `AnnualLeaveForm`(수동 부여 폼)
- `app/employees/[id]/AnnualLeaveForm.tsx` — 수동 부여 입력 UI
- `app/leave-summary/page.tsx`:59 — 연차정산 화면 "발생=annualLeaveDays(올해만), 과거연도는 '—'"
- `app/leave-summary/export/route.ts`:48 — 정산 엑셀 "발생"

## 🔴 영향 범위 (annualLeaveDays를 읽는 모든 곳 = 5곳)
1. `leave.ts:requestLeave` — 신청 초과검사 (잔여 계산)
2. `leave/page.tsx` — 직원 본인 부여/잔여 표시
3. `employees/[id]/page.tsx` — 관리자 직원상세 잔여 표시
4. `leave-summary/page.tsx` — 연차정산 발생/잔여
5. `leave-summary/export/route.ts` — 정산 엑셀 발생
→ "발생(부여)"을 자동계산으로 바꾸면 **이 5곳이 모두 같은 계산을 써야** 숫자가 일치한다.
   (지금은 전부 `user.annualLeaveDays` 한 필드를 읽으므로, 공용 함수 `grantedAnnualLeave(user)`를
    만들어 5곳이 같이 부르게 하는 게 안전.)

## 쓰는 곳 (hireDate) — 계산엔 미사용, 표시/저장만
- `employees.ts`/`invites.ts`/`employee-profile.ts` — 저장(입력)
- `employees/[id]/page.tsx`·`ProfileForm.tsx`·`invite/InviteForm.tsx` — 표시/입력
- `leave-summary` page·export — 표시/엑셀
→ **hireDate는 nullable**(미입력 직원 존재 가능). 자동계산의 유일한 입력값이라 **미입력 대비책 필수**.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- `lib/leave.ts` = 공통 순수함수 모듈 → 발생계산 함수를 **추가(add-only)** 하면 기존 함수 무수정, 회귀위험 격리 가능.
- `annualLeaveDays` 필드를 없애면 5곳 + 마이그레이션 + 기존 데이터 영향 큼 → **필드 유지**하고 의미만 재정의(자동값 or 수동 override)가 안전.

## DB·API 변경 여부, 위험 요소
- **스키마 변경 최소화 가능**: 발생을 "저장 안 하고 매번 계산"하면 마이그레이션 불필요(EPERM 서버끄기 회피).
  - 관리자 수동 조정(특별부여)을 남기려면 override 저장 필요 → 기존 `annualLeaveDays`를 override 용도로 재활용(스키마 무변경) 가능.
- **동시성/성능**: 발생계산은 순수함수(입사일+오늘) → DB 부하 없음, N+1 없음.
- **정확도 위험(법적)**: 근로기준법 연차는 ①1년 미만 월차 ②80% 출근율 ③3년+ 가산 등 **조건부**. 근태 데이터까지 반영하면 정확하나 복잡. 간소화 수준을 사장님이 정해야 함(아래 결정사항).

## 근로기준법 제60조 요약 (자동계산의 근거)
- **1년 미만**: 1개월 개근 시 1일씩 발생 → 최대 11일.
- **1년 이상 + 그 1년 80% 이상 출근**: 15일.
- **3년 이상 계속근로**: 최초 1년 넘는 매 2년마다 1일 가산 → 3년차 16, 5년차 17 … **한도 25일**.
- 발생 기준: **입사일 기준**이 원칙(회계연도 1/1 기준 갈음도 실무상 허용, 규칙 상이).

## 결론 (계획 시 사장님 결정 필요 항목)
1. **기준일**: 입사일 기준(법 원칙·단순) vs 회계연도(1/1) 기준(노무 편의).
2. **정확도 수준**: 1년 미만 월차/80% 출근율/개근을 근태데이터로 정확히 vs 근속기간만으로 간소 근사.
3. **수동 조정(override) 유지 여부**.
4. **hireDate 미입력 직원 처리**: 기존값 유지 / 15 기본 / "입사일 입력 필요" 표시.
5. **저장 vs 계산**: 스키마 무변경(계산 기반) 권장.
