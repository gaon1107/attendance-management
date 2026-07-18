# Plan: B-2 연차 자동발생 (2026-07-18) — 상태: 검토 대기

## 사장님 결정 (확정)
- 기준일 = **입사일 기준**
- 정확도 = **간소(근속기간만)** — 개근·80% 출근율은 "충족 가정", 예외는 관리자 수동조정
- 수동 조정 = **유지**(자동값 기본 + 관리자 예외 부여/감액)

## 1. 접근 방식 (+이유)
"발생(부여) 연차"를 **입사일+오늘로 매번 자동계산**하되, 관리자가 예외적으로 **덮어쓸 수 있는 값(override)**을 둔다.
- 자동계산은 `lib/leave.ts`에 **순수함수 add-only** → 기존 로직 무수정, 단위테스트로 검증 쉬움.
- 발생을 읽는 5곳 전부 **공용 헬퍼 하나**(`annualLeaveGranted(user)`)를 부르게 해 숫자 불일치 방지.
- override는 **nullable 컬럼 1개**(`annualLeaveOverride Float?`)로 저장. `null`=자동, 값=관리자 지정.
  - 이유: 지금 `annualLeaveDays`(기본 15, non-null)는 "자동인지 관리자가 정한 15인지" 구분 불가 → 자동/수동을 나누려면 nullable 필드가 정직한 유일한 방법. (과거 `add_notice_date`와 같은 "nullable 추가=하위호환" 패턴)

## 2. 자동계산 공식 (간소·입사일 기준)
```
grantedAnnualLeave(hireDate, 오늘):
  입사일 없음 → 15 반환 (안전 기본값, 화면에 "입사일 입력 시 정확 계산" 안내)
  근속 = 오늘 − 입사일
  1년 미만 → min(완전근속개월, 11)      // 1개월당 1일(개근 가정), 최대 11
  1년 이상 → base = 15
             3년 이상이면 base += floor((근속연수 − 1) / 2)   // 3년차 16, 이후 2년마다 +1
             min(base, 25) 반환                              // 법정 한도 25
검증표: 11개월=11 / 1년=15 / 2년=15 / 3년=16 / 5년=17 / 21년=25(상한)
```

## 3. 수정/생성 파일 목록
| # | 파일 | 변경 |
|---|---|---|
| 1 | `prisma/schema.prisma` | User에 `annualLeaveOverride Float?` **추가**(nullable). 마이그레이션 1건. ⚠️서버 끄기 |
| 2 | `lib/leave.ts` | `grantedAnnualLeave(hireDate, asOf?)` 순수함수 + `annualLeaveGranted(user)` 헬퍼 **추가(add-only)** |
| 3 | `app/actions/leave.ts` | `requestLeave` 잔여계산→헬퍼 / `setAnnualLeave`→override에 저장 + "자동으로 되돌리기"(null) 지원 |
| 4 | `app/leave/page.tsx` | 부여/잔여 헬퍼 사용 + "자동 계산" 표기 |
| 5 | `app/employees/[id]/page.tsx` | 잔여 헬퍼 사용 |
| 6 | `app/employees/[id]/AnnualLeaveForm.tsx` | 자동값 표시 + 수동 override 입력 + "자동으로" 버튼 |
| 7 | `app/leave-summary/page.tsx` | 올해 발생=헬퍼(자동), 과거연도 '—' 로직 유지 |
| 8 | `app/leave-summary/export/route.ts` | 발생=헬퍼 |

## 4. 🛡️ 사이드 이펙트 방어
- **발생을 읽는 5곳 일치**: 전부 `annualLeaveGranted(user)` 한 함수로 통일 → 화면마다 숫자 다른 사고 방지.
- **이미 쓴 연차 > 새 자동발생**일 수 있음(예: 수동 20일→자동 15일): 잔여가 음수가 될 수 있음.
  → 잔여는 **실제값 그대로 표시**(음수 숨기지 않음, 관리자가 인지). 신청 초과검사는 기존대로 잔여 기준 유지.
- **hireDate 미입력 직원**: 자동 15일 fallback + 화면 안내(계산이 멈추지 않게).
- **override 있는 직원**: 자동계산 무시하고 그 값 사용(관리자 의도 존중).
- **마이그레이션 데이터**: 기존 직원 전원 `annualLeaveOverride = null`(=전원 자동 전환). 기존 `annualLeaveDays` 값은 더 이상 안 읽음(휴면). ※ 특별값 있던 직원은 관리자가 override 재입력. (대안: 마이그레이션에서 기존값을 override로 복사 → 아래 메모 참고)
- **구현 후 반드시 테스트할 기존 기능**: ①휴가 신청 초과검사 ②직원 [휴가] 부여/잔여 ③직원상세 잔여+수동폼 ④연차정산 화면·엑셀(올해/과거연도) ⑤일반 출퇴근·다른 화면 회귀 없음.

## 5. 작업분해 TODO
- [ ] 1. `lib/leave.ts`에 `grantedAnnualLeave`+`annualLeaveGranted` 추가 + **단위테스트**(경계값 11개월/1·2·3·5·21년/입사일없음/override)
- [ ] 2. `prisma/schema.prisma` `annualLeaveOverride Float?` 추가 → (서버 끄고) 마이그레이션·generate
- [ ] 3. `setAnnualLeave`(override 저장 + 자동복귀) + `AnnualLeaveForm` UI(자동값·수동·자동버튼)
- [ ] 4. 읽는 5곳 헬퍼로 교체(requestLeave·leave/page·employees/[id]·leave-summary page·export)
- [ ] 5. 영향 기존기능 테스트(위 5종) + 실행 증거
- [ ] 6. code-reviewer 검수 + project-status.md 갱신

## 6. 구현하지 않을 것 (범위 제외)
- 근태데이터 기반 개근·80% 출근율 정밀계산(=간소 결정) → 추후 별도.
- 연차촉진(사용독려)·소멸·이월 계산 → 범위 밖.
- 회계연도 기준 정산 → 입사일 기준 결정으로 제외.
- 1년 미만 "월 개근" 실판정(결근 반영) → 관리자 수동조정으로 대체.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- (예: hireDate 없을 때 15 대신 0으로? / 마이그레이션 때 기존값을 override로 복사할지 / 잔여 음수를 0으로 막을지)
-
