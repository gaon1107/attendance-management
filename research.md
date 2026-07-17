# Research: A-1 생체정보 파기 시 GaonFR 원본삭제 배선 (2026-07-17)

## 무엇을 고치나 (한 줄)
직원이 얼굴정보를 **철회/파기**할 때, 우리 DB 표시와 로컬 사진은 지워지지만 **사내 얼굴서버(GaonFR)에 등록된 얼굴 원본은 그대로 남는다.** 이 원본까지 실제로 삭제되도록 "배선(연결)"한다. (생체정보 파기 = 법적 의무)

## 관련 파일과 역할
- **webapp/app/actions/authmethod.ts** — 파기 3곳(고칠 대상)
  - `chooseGps()` (line 30): 직원이 GPS만 사용 선택 → 얼굴 동의 해제
  - `withdrawBiometric()` (line 65): 직원 본인 동의 철회(삭제 요청)
  - `adminRevokeBiometric(formData)` (line 82): 관리자가 특정 직원 생체정보 파기(회사 격리 검사 있음)
  - 현재 세 함수 모두: `hadBiometric()`로 파기여부 판단 → User update(`authMethod:"gps", faceConsentAt:null`) → `purgePhotosSafely()`(로컬 사진 파기, bool 반환) → `logAdminAction(..., purged ? "success":"fail")`
  - 주석에 명시적으로 "**(실제 얼굴 데이터 삭제는 2단계 GaonFR 연동)**"이라고 미완성 표기됨 (line 64, 81) → 이번이 그 2단계.
- **webapp/lib/face.ts** `unenrollFace(faceId, group)` (line 227): GaonFR에서 얼굴 삭제. 반환 `{ success, message? }`. **이미 존재, 무수정.**
- **webapp/app/actions/face.ts** `deleteMyFace()` (line 342): **이미 올바르게 배선된 참고 예시.** `me.faceEnrolledAt` 있으면 `unenrollFace(me.id, me.companyId)` 호출 → User의 `faceEnrolledAt:null, faceEnrollCount:0` 정리.
- **webapp/lib/audit.ts** `logAdminAction()`: 감사로그. result에 실제 결과 반영(원칙 ④: 실패면 "fail"). **무수정.**
- **webapp/lib/clock-photo.ts** `purgeUserPhotos()`: 로컬 사진 파기. **무수정.**

## 핵심 발견: `faceConsentAt` ≠ `faceEnrolledAt`
- `faceConsentAt` = **동의** 시각 (동의 상태)
- `faceEnrolledAt` = **GaonFR에 얼굴 등록** 완료 시각 (null=미등록). **얼굴서버에 뭔가 있는지의 진짜 지표.**
- `hadBiometric()`은 `authMethod==="face" || faceConsentAt!==null`로 **파기 로그를 남길지**를 정한다.
- 반면 **GaonFR 삭제를 부를지는 `faceEnrolledAt`으로 판단**해야 한다(deleteMyFace와 동일). 등록이 없으면 지울 원본도 없다.
- **현재 버그**: 파기 3곳이 `faceEnrolledAt`을 **null로 바꾸지 않고** `unenrollFace`도 부르지 않는다 → 철회 후에도 얼굴이 GaonFR에 남고, DB엔 "얼굴 등록됨" 표시가 유령처럼 남는다. 재동의 시 그 유령 등록이 되살아난다.

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳)
- **authmethod.ts의 3함수 호출처** (grep 전수 확인):
  - `chooseGps`, `withdrawBiometric` ← webapp/app/auth-method/page.tsx (직원 인증방식 화면)
  - `adminRevokeBiometric` ← webapp/app/biometrics/BiometricsList.tsx (관리자 생체정보 화면)
  - → 그 외 호출처 **없음.** 동작 변화 = "이제 GaonFR 원본도 삭제되고 등록표시도 해제된다"(=의도된 수정).
- **`unenrollFace` 호출처**: 기존 `deleteMyFace` 1곳(무변경) + 이번에 3곳 추가. face.ts 자체는 무수정.
- **`faceEnrolledAt`/`faceEnrollCount`를 null/0로 바꿀 때 영향받는 화면** (grep 전수):
  - auth-method/page.tsx(31,70,85), attendance/page.tsx(64,102), face-enroll/page.tsx(21,60,61,70) — **전부 읽기전용 표시/게이팅.** 파기 후 "미등록"으로 보이는 게 정상(현 유령표시 버그도 함께 해소). **깨지는 로직 없음.**

## 공통 모듈 여부 / 건드리면 안 되는 부분
- **lib/face.ts는 공통 모듈** — 이번엔 **호출만** 하고 수정하지 않는다(project-status.md "건드리면 안 되는 부분" 준수: recognizeFace 필드·판정로직 무수정).
- audit.ts / clock-photo.ts / ip.ts 무수정.
- authmethod.ts만 수정(고칠 대상 파일). 3함수가 다 이 파일 안이고 서로만 호출 → safe-coding "공용함수" 대상 아님.

## DB·API 변경 여부, 위험 요소
- **DB 스키마 변경 없음** (기존 컬럼 값만 변경). **마이그레이션 불필요 → 서버 끌 필요 없음(EPERM 무관).**
- **위험 1 — unenrollFace에 타임아웃 없음**: face.ts의 `unenrollFace`는 `recognize`/`detect`와 달리 `AbortSignal.timeout`이 없다. GaonFR이 응답을 멈추면 `await`가 오래 매달릴 수 있고, 철회/파기 액션이 redirect 전에 블로킹된다.
  - 단, **이는 기존 위험**이다(`deleteMyFace`도 동일하게 unenrollFace를 블로킹 await). 이번 배선이 새로 만든 위험이 아니라 기존 패턴을 3곳에 확장하는 것.
  - 완화 옵션(플랜에서 선택): unenrollFace에 `AbortSignal.timeout(10_000)` 추가 → 단 공통모듈 수정이라 deleteMyFace에도 영향 → **safe-coding 절차 + 사장님 승인 필요**. 기본은 "무수정, 위험만 기록".
- **위험 2 — GaonFR 꺼져 있으면**: 삭제 실패 → 우리 DB 파기·로컬 사진 파기는 정상 완료(원칙 ①), 감사로그 result="fail"로 정직하게 남김. 재시도는 재파기 또는 별도 재시도(백로그).
- **동시성/N+1/보안**: 해당 없음(단건 처리, 회사 격리 검사 기존 유지).

## 결론 (계획 시 고려사항)
1. 세 함수 모두 **deleteMyFace 패턴을 그대로 미러링**한다 — 가장 검증된·최소 변경.
2. update 전에 `wasEnrolled = user.faceEnrolledAt !== null` 캡처(update 뒤엔 항상 null).
3. User update의 data에 `faceEnrolledAt: null, faceEnrollCount: 0` 추가.
4. `wasEnrolled`면 GaonFR 삭제(작은 헬퍼 `unenrollFaceSafely`) → 성공여부 bool.
5. 감사로그 result = **`(purged && unenrolled) ? "success" : "fail"`** — 로컬+GaonFR 둘 다 성공해야 "성공"(백로그 요구: 원본삭제 성공여부 반영).
6. `getCurrentUser()`는 user 전체(company include)를 반환 → `faceEnrolledAt`·`companyId` 사용 가능(확인됨). adminRevoke의 `target`도 findFirst 전체 레코드라 사용 가능.
7. 검증: 얼굴서버(gaonfrdev) 켠 상태에서 등록→철회→GaonFR에서 실제 삭제·감사로그 result 확인 필요(사장님 환경).
