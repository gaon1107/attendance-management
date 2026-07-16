# Research: 접속/보안 4단계 — 관리자 감사로그 (2026-07-16)

> 목표: **관리자가 회사 설정을 바꾸거나 직원 생체정보를 파기하면 "누가·언제·무엇을" 기록에 남긴다.**
> 3단계까지 = 로그인·출퇴근 "접속" 기록. 4단계 = 관리자 "행위" 기록(감사).

## 창고(DB) — 변경 불필요

`AccessEvent`의 `kind`에 **이미 `config`(설정 변경)·`purge`(생체정보 파기)·`data_view`(민감 데이터 조회)가 정의**돼 있고,
`lib/access-labels.ts`에도 한글 라벨("설정 변경"·"생체정보 파기"·"데이터 조회")이 이미 있다.
→ **스키마 변경 없음. 라벨 추가 없음.** 기록을 남기는 호출부만 add-only로 붙이면 된다.

## 🔴 영향 범위 — 기록을 붙일 후보(관리자 행위)

| 파일 | 함수 | 무엇을 바꾸나 | 기록 대상? |
|---|---|---|---|
| `actions/settings.ts` | `saveOfficeLocation` | 사업장 위치·반경·주소 | ✅ config |
| | `saveOfficeNetwork` | **사내 허용 IP** | ✅ config (보안 핵심) |
| | `saveFaceRule` | 얼굴 크기·밝기 기준 | ✅ config |
| | `saveLivenessRule` | 위조 판독 기준 | ✅ config |
| | `saveWorkRules` | 근무시간·지각기준·기준시간 | ✅ config |
| `actions/authmethod.ts` | `adminRevokeBiometric` | **관리자가 직원 생체정보 파기** | ✅ purge (법적 핵심) |
| | `withdrawBiometric`·`chooseGps` | 본인이 스스로 철회 | ✅ purge (본인 행위지만 생체정보 파기 이력은 남아야 함) |
| | `agreeBiometric` | 본인 동의 | ⬜ 이번 제외(동의시각은 User.faceConsentAt에 이미 남음) |
| `actions/company.ts` | `saveCompanyInfo`·`deleteCompanyDoc`·`deleteCompanyLogo` | 회사정보·첨부문서 | ⬜ 이번 제외(2차 검토) |
| `actions/employees.ts` | `deactivateEmployee`·`resetEmployeePassword` 등 | 직원 관리 | ⬜ 이번 제외(2차 검토) |
| `app/api/clock-photo/[id]/route.ts` | 사진 열람 | 생체정보 사진 열람 | ⬜ **이미 자체 열람기록 있음** — 중복 방지 위해 제외 |

## 공통 모듈 여부 / 건드리면 안 되는 부분

- 위 함수들은 **각 화면 전용**(공통 모듈 아님). 호출처 확인 결과 각각 1곳(해당 화면 폼)에서만 사용.
- `lib/access-log.ts`의 `recordAccess`·`readClientMeta`는 **이미 만들어진 공통 도구 — 그대로 호출만** 한다(무수정).
- 🚧 `lib/ip.ts`·`clockIn/clockOut`·`liveness.ts`·`ACCESS_RETENTION_DAYS` — 이번 작업과 무관, 안 건드림.

## ⚠️ 위험 요소 (구현 시 반드시 반영)

1. **`redirect()`가 뒤 코드를 삼킨다** — `chooseGps`·`withdrawBiometric`은 `redirect()`로 끝난다.
   Next의 `redirect()`는 내부적으로 **예외를 던져** 흐름을 끊으므로 **기록을 redirect 앞에 넣어야** 한다.
   또한 **try/catch로 감싸면 redirect 예외를 삼켜 화면 이동이 깨진다** → 기록만 감싸고 redirect는 밖에 둔다.
2. **settings.ts 함수들은 `{error}`를 return하는 useActionState 형식** — 실패 시 조기 return 하므로
   **성공 지점(update 뒤·return {ok:true} 앞)** 에만 기록해야 "실패했는데 변경됨"으로 남지 않는다.
3. **기록이 본기능을 막으면 안 됨**(3단계와 동일 원칙) — `recordAccess`는 자체 try/catch, 추가로 `headers()` 호출도 보호.
4. **무엇을 바꿨는지(meta)**: 값 자체를 통째로 남기면 개인정보·비밀값이 로그로 샐 수 있다 →
   **"어느 설정을 바꿨다"는 이름만** 남긴다(예: `office_network`). 실제 값은 남기지 않는다.
5. **회사 격리**: `adminRevokeBiometric`은 이미 `companyId` 확인 후 처리 — 기록도 그 뒤에.

## DB·성능

- 스키마 변경 없음. 기록 1건 = INSERT 1회, 관리자 행위는 빈도가 낮아 성능 영향 무시 가능.
- 3단계에서 만든 `@@index([createdAt])`·2년 파기가 그대로 적용됨.

## 결론

- **위험이 낮다**: 새 창고·새 공통함수 없이, 이미 있는 도구를 성공 지점에서 호출만 한다.
- **유일한 함정은 `redirect()` 순서** — 이것만 지키면 된다.
- 화면은 3단계에서 만든 `/security/access`에 **"관리자 동작" 필터 한 칸만 추가**하면 끝(새 화면 불필요).
