# Research: 오려낸 사진 공격 방어 — 질감 검사 + 연속 촬영 (2026-07-11)

## 요청 배경
- 얼굴 모양으로 오려낸 인쇄 사진이 판독을 자주 통과함 (사장님 실측: 구부린 오린 사진 84.7% 통과).
- 원인: 두 모델(MiniFASNet)은 얼굴 주변을 4.0배/2.7배 넓게 잘라 "종이 테두리" 같은 주변 단서에 크게 의존하는데, 오려내면 그 단서가 사라짐. 남는 단서(인쇄 질감)는 80×80 축소 때 뭉개짐.
- 방어 목표: ⑴ 얼굴 최소 크기 강제 ⑵ 축소 전 원본 해상도에서 인쇄 망점·화면 격자 검사 ⑶ 연속 여러 장 전부 통과 요구.

## 관련 파일과 역할
| 파일 | 역할 |
|---|---|
| [lib/liveness.ts](lib/liveness.ts) | 판독 핵심. 사진 1장+얼굴 위치 → 두 모델 점수. **⚠️ 근태 webapp 이식(1단계) 대상 — 데모 전용 로직 금지** (파일 상단 주석) |
| [lib/gaonfr.ts](lib/gaonfr.ts) | 얼굴서버(GaonFR) 연동 — 얼굴 위치 검출(detect)만. 토큰 2단계 캐시. 429(요청 폭주) 응답 처리 있음 |
| [app/actions/liveness.ts](app/actions/liveness.ts) | 서버 액션. 사진 1장 수신(≤900KB) → detect → **얼굴 크기 기준(minPercent) 검사** → analyzeFace |
| [app/DemoClient.tsx](app/DemoClient.tsx) | 데모 화면. 웹캠 1장 촬영 → 액션 호출 → 점수·이력 표시. 가이드 타원 + 크기 슬라이더(10~50%, 기본 30) + 판정 기준 슬라이더 |
| [app/page.tsx](app/page.tsx) | 데모 페이지 셸 (환경설정 확인만) |
| models/*.onnx | MiniFASNetV1SE·V2 (Apache-2.0, NOTICE.md에 출처 고지) |

## ✅ 이미 구현되어 있는 것 (이번 작업에서 제외)
- **얼굴 최소 크기 검사**: 서버가 minPercent(기본 30%) 미달이면 판독 없이 거절(tooSmall) — [app/actions/liveness.ts:47-65](app/actions/liveness.ts). 화면 가이드 타원·슬라이더 연동 완료.

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳 — 전수 검색 결과)
- `analyzeFace` (lib/liveness.ts) → 호출처: app/actions/liveness.ts **1곳뿐**
- `detectFaces`, `isConfigured` (lib/gaonfr.ts) → 호출처: app/actions/liveness.ts, app/page.tsx **2곳뿐**
- `analyzeLiveness` (서버 액션) → 호출처: app/DemoClient.tsx **1곳뿐**
- 이 프로젝트는 데모 단독 앱. 외부(근태 webapp)가 이 코드를 import하는 곳은 현재 없음 — 단, lib/liveness.ts·lib/gaonfr.ts는 **나중에 근태로 그대로 복사해 갈 파일**이므로 데모 전용 로직을 섞으면 안 됨.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- **건드리지 않을 것**: lib/liveness.ts의 전처리(크롭 배율·80×80·linear 커널·BGR) — 주석 경고대로 커널이 바뀌면 점수가 최대 12%p 요동. 연속 촬영은 이 함수를 프레임별로 "그대로 여러 번 호출"만 하면 되므로 **수정 불필요**.
- lib/gaonfr.ts도 수정 불필요 (프레임별 detect 재호출).
- 신규 질감 검사는 **새 파일(lib/texture.ts)** 로 분리 — 근태 이식 시 함께 가져갈 수 있는 순수 계산 모듈로.

## 기술 제약·위험 요소
1. **서버 액션 본문 한도 1MB**: 현재 next.config 파일이 없음 → Next.js 기본값 1MB. 사진 1장이 최대 900KB라 3~5장을 한 번에 보내면 초과. → next.config에서 `serverActions.bodySizeLimit` 상향 필요(신규 파일이라 다른 기능 영향 없음). 촬영 시 프레임별 재압축(≤850KB)은 클라이언트에 이미 있음.
2. **얼굴서버 429(요청 폭주)**: 연속 3장이면 detect도 3회. gaonfr.ts에 429 처리 존재. 프레임을 병렬이 아니라 **순차** 호출해 위험 최소화. 429 발생 시 그대로 실패 메시지 반환(기존 동작 유지).
3. **판독 시간 증가**: 1장당 detect+판독 수백 ms → 3장이면 약 3배. 데모에서 실측해 근태 적용 시 허용 범위인지 확인 필요.
4. **질감 검사 기준값**: 웹캠 화질·조명 의존이 큼. 남의 기준을 못 씀 → **1차 배포는 "점수 표시만"(판정 미반영, 관찰 모드)** 으로 내보내고, 진짜 얼굴/오린 사진 실측 데이터를 모은 뒤 기준값을 정해 판정에 반영하는 2단계 방식이 안전(오탐으로 직원이 억울하게 걸리는 것 방지).
5. **git 저장소 아님**: 사규 7항(기능 단위 커밋)을 지키려면 git init 필요. .gitignore는 이미 있음.

## DB·API 변경 여부
- DB 없음. 외부 API(GaonFR)는 호출 횟수만 늘고 계약 변경 없음. 서버 액션의 입출력 형태는 확장(기존 필드 유지 + 신규 필드 추가)으로 호환 유지.

## 결론 (계획 시 고려사항)
- 작업 범위 = ② 질감(망점·모아레) 검사(신규 lib/texture.ts, 관찰 모드부터) + ③ 연속 3장 촬영·전 프레임 통과 판정(액션 확장 + 화면 확장).
- lib/liveness.ts·lib/gaonfr.ts는 무수정. 신규/수정은 texture.ts(신규), next.config.ts(신규), app/actions/liveness.ts(확장), app/DemoClient.tsx(확장)에 한정.
- 검증 재료: public/test-real.jpg, public/test-fake.jpg로 질감 점수 스크립트 검증 + 웹캠 실촬영.
