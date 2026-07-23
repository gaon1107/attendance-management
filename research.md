# Research: B-6 외출 사유 회사별 편집 (2026-07-23)

## 배경
보완작업 백로그 B-6. 직원이 출퇴근 화면에서 [외출]을 누를 때 고르는 사유가 **4종 하드코딩**이라 회사마다 바꿀 수 없다.

```ts
// webapp/app/attendance/page.tsx:20
const REASONS = ["식사", "외근", "개인용무", "기타"];
```

## ⚠️ 먼저 짚을 것 — "외출"이 두 종류다 (헷갈리기 쉬움)

| | ①**실시간 외출 기록** (이번 대상) | ②외출/외근 **신청·결재** (대상 아님) |
|---|---|---|
| 어디 | 직원 [출퇴근] 화면의 [외출]/[복귀] 버튼 | 직원 [외출외근] 메뉴 → 관리자 승인 |
| 표 | `Break` (attendance.ts `startBreak`) | `OutingRequest` (2026-07-20 결재세트) |
| 사유 | **드롭다운 4종 하드코딩 ← 이번에 고칠 것** | 자유 입력 텍스트(제한 없음) |

**이번 작업은 ①만** 건드린다. ②(결재)는 무접촉.

## 관련 파일과 역할
- **[app/attendance/page.tsx](webapp/app/attendance/page.tsx):20, :185** — 사유 상수 + 외출 드롭다운(`<select name="reason" defaultValue="식사">`). **여기가 유일한 선택 화면.**
- [app/actions/attendance.ts](webapp/app/actions/attendance.ts):129 `startBreak` — 폼의 `reason`을 **검증 없이 그대로** `Break.reason`에 저장(기본값 "기타").
- [prisma/schema.prisma](webapp/prisma/schema.prisma):248 `model Break` — `reason String`(자유 문자열, 주석에 4종 나열).
- [app/settings/page.tsx](webapp/app/settings/page.tsx) + `OfficeNetworkForm`·`WorkRulesForm` 등 — **회사별 설정 카드 패턴**(이번에 그대로 따라감).
- [app/actions/settings.ts](webapp/app/actions/settings.ts):47 `saveOfficeNetwork` — 설정 저장 서버액션 패턴(관리자 검증 → `company.update`).

## 🔴 영향 범위 (`Break.reason`을 쓰는 곳 전수 검색)
| 위치 | 하는 일 | 사유 목록을 바꾸면? |
|---|---|---|
| `attendance/page.tsx`:185 | 사유 **선택**(드롭다운) | ✅ 이번에 바뀜 |
| `attendance/page.tsx`:158 | "외출 중 · {사유}" 현재상태 표시 | 저장된 문자열 그대로 출력 → **무영향** |
| [DetailTable.tsx](webapp/app/components/DetailTable.tsx):184 | 근태상세에서 외출 이력의 사유 표시 | 저장된 문자열 그대로 출력 → **무영향** |
| dashboard / records / my-records / reports / reports-export / print | **횟수·시간만** 사용(`breaks.length`, 시간차). 사유 문자열 **안 봄** | **무영향** |
| [lib/worktime.ts](webapp/lib/worktime.ts):12 | 외출 시간을 근무시간에서 차감 | 사유와 무관 → **무영향** |

→ **사유 문자열로 분기(if)하는 로직이 한 곳도 없다.** 목록을 바꿔도 과거 기록·통계·근무시간 계산이 깨지지 않는다. **회귀 위험 낮음.**

## 공통 모듈 여부
- `attendance/page.tsx`의 `REASONS`는 **그 파일 안에서만** 쓰는 지역 상수(export 안 함) → 공통 모듈 아님.
- 단, 새로 만들 "사유 목록 해석 함수"는 **화면·서버액션 양쪽이 쓰므로 `lib/`에 단일 출처로** 둔다(프로젝트 관례).

## DB 변경
**필요.** 회사별 값을 저장할 칸이 없다 → `Company`에 **nullable 칸 1개 add-only** 추가 + 마이그레이션.
- 기존 회사는 값이 비어 있음 → **기본 4종으로 자동 폴백**(설정 안 해도 지금과 똑같이 동작).
- 저장 형식은 프로젝트 관례를 따라 **쉼표 구분 문자열**(`officeIps`, `workDays`와 동일 방식) — 표를 새로 만들 필요 없음.

## 위험 요소
1. **폼 위조**: `startBreak`가 사유를 검증하지 않아, 지금도 개발자도구로 아무 문자열이나 저장 가능(기존 한계). 이번에 목록 검증을 넣으면 함께 막힌다.
2. **마이그레이션 함정**: dev 서버가 켜져 있으면 `prisma migrate`가 DLL 잠금으로 실패 → **서버 끄고 실행**(webapp/CLAUDE.md 명시).
3. **과거 기록**: 회사가 "식사"를 목록에서 지워도 **이미 저장된 기록은 "식사"로 남는다**(이력 보존이 맞음). 표시에 문제 없음.
4. **사유별 근무시간 차감 구분 없음**: 지금은 "외근"으로 나가도 근무시간에서 **전부 차감**된다. 이번 범위 밖(사장님 결정 사안)이라 **보고만** 한다.

## 결론 (계획 시 고려사항)
- 설정 화면은 기존 [설정] 페이지에 **카드 1개 추가**가 가장 자연스럽다(사내 네트워크·근무 규칙과 같은 자리).
- 목록 해석(빈값→기본 4종, 쉼표 분리, 공백·중복 정리)은 **순수함수 1개로 단일 출처화** → 임시 라우트로 테스트 가능.
- 총 변경 규모: 스키마 1칸 + lib 1파일 + 서버액션 1개 + 설정폼 1개 + 기존 화면 2곳(attendance 화면·startBreak) 배선.
