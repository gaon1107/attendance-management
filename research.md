# Research: C-1 사번(employeeNo) 회사내 중복검사 (2026-07-17)

## 무엇을 고치나 (한 줄)
같은 회사 안에서 **사번이 겹치게 저장되는 것**을 막는다. 지금은 검사 없이 그대로 저장돼 두 직원이 같은 사번을 가질 수 있다.

## 관련 파일과 역할
- **prisma/schema.prisma:154** `employeeNo String?` — 선택 항목(null 허용), `@unique` 없음. 주석에도 "현재 중복검사 없음(단순 저장)".
- **lib/employee-profile.ts** `parseProfile(fd)` — 폼값 → 정규화(공백제거, 60자 상한, 빈값=null). **초대가입·관리자수정 공용**. 순수 함수(DB 접근 없음). employeeNo는 line 48·58.
- **저장 경로 2곳(여기에 검사 추가)**:
  1. **app/actions/employees.ts:75 `updateEmployeeProfile`** — 관리자가 직원 상세에서 인적정보 수정. `me.role==="admin"` + 회사격리(`findFirst{id, companyId: me.companyId}`). `{error?}` 반환 → 폼이 에러 표시(ProfileForm.tsx).
  2. **app/actions/invites.ts:44 `acceptInvite`** — 초대 링크로 신규 직원 가입. `companyId = invite.companyId`. 이미 email 중복검사 존재(line 62-63, `findUnique` + `{error}`) → **같은 패턴으로 사번 검사 추가하면 일관됨**. `{error?}` 반환 → InviteForm.tsx가 표시.
- **표시 화면(읽기, 무수정)**: employees/[id]/page.tsx(사번 표시), ProfileForm.tsx(수정폼 input), InviteForm.tsx(가입폼 input).

## 🔴 영향 범위 (employeeNo 쓰는 모든 곳 — grep 전수)
- 쓰기(값 저장): `updateEmployeeProfile`, `acceptInvite` **2곳뿐**. (여기만 검사 추가 대상)
- 읽기(표시): employees/[id]/page.tsx:71·147, ProfileForm.tsx:49, InviteForm.tsx:55 — 단순 표시/입력, 검사와 무관.
- `parseProfile`는 **공용 파서**지만 이번엔 **무수정**(파싱은 그대로, 중복검사는 파서 바깥 DB 조회로 별도 추가). → 다른 기능(전화·직급·입사일) 회귀 위험 없음.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- `parseProfile`(공용) **무수정** — 순수 파서 유지(DB 의존성 안 넣음).
- schema.prisma **무변경 권장**(아래 접근방식 참고) → 마이그레이션·서버끄기 불필요.
- 회사격리 기존 검사 유지.

## DB·API 변경 여부, 위험 요소
- **접근 A(앱단 검사, 권장)**: 저장 전에 "같은 회사에 같은 사번 가진 다른 직원이 있나" DB 조회 → 있으면 친절한 에러 반환. **스키마 무변경 → 마이그레이션·서버끄기 없음.** 기존 email 중복검사와 동일한 방식(코드 일관).
  - 위험: 이론상 동시 제출 경쟁(TOCTOU) — 거의 동시에 같은 사번 2건 저장 시 둘 다 통과 가능. 관리자 1명·간헐적 가입이라 실사용 확률 극히 낮음. 완벽 차단은 접근 B 필요.
- **접근 B(DB 유니크 제약)**: `@@unique([companyId, employeeNo])` 추가. 이론상 완벽하나 ①**마이그레이션=서버 끄기(EPERM)** ②기존 중복 데이터 있으면 마이그레이션 실패 ③SQLite는 NULL 여러 개 허용(사번 미입력 다수 OK)이나 Prisma 원시 에러를 잡아 친절 메시지로 바꾸는 처리 필요. → 무겁고 범위 큼.
- **결정 필요 사항**:
  - (가) 검사 대상에 **퇴사자(deactivatedAt≠null)** 포함? → 제외 권장(퇴사한 사람 사번을 신입이 재사용 가능하게). 포함하면 과거 사번이 영구 점유됨.
  - (나) 대소문자/공백: 이미 parseProfile이 trim함. 대소문자 구분은 그대로(사번은 보통 숫자·하이픈이라 문제 적음).

## 결론 (계획 시 고려사항)
1. **접근 A(앱단 검사)** 채택 권장 — 가볍고 안전, 마이그레이션 없음, 기존 email 검사와 일관.
2. 공용 헬퍼 `employeeNoTaken(companyId, employeeNo, exceptUserId?)` 하나로 두 경로가 같은 규칙 사용(중복 로직 방지). 활성 직원(deactivatedAt=null)만 검사.
3. `updateEmployeeProfile`은 **자기 자신 제외**(exceptUserId=target.id) — 본인 사번 유지한 채 다른 항목 수정 시 자기와 충돌 오탐 방지.
4. `acceptInvite`는 email 검사 바로 뒤에 사번 검사 추가(같은 자리·같은 형식).
5. 사번 **미입력(null)**은 검사 안 함(여러 명 미입력 허용).
6. (선택) 접근 B(유니크 제약)는 추후 방어층으로 별도 승인 시 — 지금은 범위 밖.
