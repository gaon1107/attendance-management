# Research: 라이브니스 후속 3건 (2026-07-11)
> ①판정 기준값 관리자 설정화 ②데모 AND 판정 비교 스위치 ③재동의 안내 배너
> 이전 버전(라이브니스 이식 리서치 — 완료된 작업)은 git 이력에 보존.

## 관련 파일과 역할
- `webapp/app/actions/face.ts` — 얼굴 출퇴근 검증 + 출퇴근 후처리(recordClockPhoto: 사진 저장·판독·suspect 판정)
- `webapp/app/actions/settings.ts` — 회사 설정 저장 액션들(saveFaceRule이 복제 원형)
- `webapp/app/settings/page.tsx` + `FaceRuleForm.tsx` — 설정 화면(폼 복제 원형)
- `webapp/prisma/schema.prisma` — Company 테이블(faceMinPercent 패턴 참고)
- `webapp/app/attendance/page.tsx`, `webapp/app/auth-method/page.tsx` — ③배너 표시 위치
- `webapp/app/consent/page.tsx` + `app/actions/authmethod.ts` — 재동의 흐름
- `liveness-demo/app/DemoClient.tsx` — ②판정 방식 토글 위치(이력에 모델A/B 점수 원본 보유)

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳 — Grep 전수 확인)
- **livenessThreshold()**: 정의 face.ts:130, 사용 face.ts:179 **단 1곳**(recordClockPhoto의 suspect 판정). 다른 파일 사용 없음 → 회사 설정 조회로 바꿔도 파급 없음.
- **LIVENESS_THRESHOLD(.env)**: face.ts:131 1곳만 읽음.
- **PHOTO_CONSENT_SINCE**: face.ts:137 정의, face.ts:153 1곳 사용. ③배너가 같은 날짜를 써야 하므로 공유 위치(lib/clock-photo.ts)로 이동 필요. ※ face.ts는 "use server" 파일이라 상수 export 불가 → 이동이 유일한 방법.
- **faceConsentAt**: 읽는 곳 8개 화면/액션 — ③은 "읽기 추가"만 하므로 기존 로직 무영향. 재동의(agreeBiometric)는 faceConsentAt=now 갱신 + authMethod="face" 유지 → **얼굴 등록(faceEnrolledAt) 안 건드림, 철회 없이 재동의 가능** (배너 링크 = /consent).
- **DemoClient.tsx**: 데모 전용(근태와 완전 분리). 이력(HistoryItem)에 v1se·v2 원본 저장돼 있어 판정 방식 토글 시 재계산 가능.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- 공통 모듈 수정 없음(사용처 1곳짜리 함수 교체 + 상수 이동 + 화면 배너 추가 + 데모 파일).
- 🚧 수정 금지 유지: lib/liveness.ts 전처리 상수 / clockIn·clockOut 본체 / 촬영 화질(1280·0.9) / FaceClockPanel 캡처 로직.

## DB·API 변경 여부, 위험 요소
- DB: Company에 `livenessPercent Int @default(50)` 추가(마이그레이션 1개). 기존 행은 기본값 50 = 현 .env 0.5와 동일 → **동작 변화 없음**.
- ⚠️ 알려진 함정: Prisma 스키마 변경 후 **dev 서버 재시작 필수**(옛 클라이언트가 새 칸을 빈칸으로 봄 — PROGRESS.md에 2회 기록된 이슈).
- 데모 수정 시 **D:\사진판독 동기화 필수**(7/11부터 규칙).
- suspect 판정은 배지용(출퇴근 차단 아님) → 값이 틀려도 출퇴근 기능 자체는 무영향(위험 낮음).

## 결론 (계획 시 고려사항)
1. ①은 faceMinPercent와 100% 동일 패턴(스키마+폼+액션+조회함수) 복제로 안전하게 가능. 단위는 %(30~90, 기본 50).
2. ②는 DemoClient.tsx 한 파일: 토글 state + 유효점수 계산(평균 or 두 모델 최소값) → 판정·색·이력 즉시 재계산. 서버 코드 무수정.
3. ③은 PHOTO_CONSENT_SINCE를 lib로 옮긴 뒤 두 화면에 배너 추가. 링크는 /consent(철회 불필요).
