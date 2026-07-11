# Research: 라이브니스(사진판독) 근태 webapp 적용 (2026-07-11)

> 사장님 지시(2026-07-11): ① 출·퇴근 시에만 판독 적용 ② 판독 결과로 출퇴근을 막지 않음(관리자가 이력에서 확인만) ③ 출퇴근에 사용된 분석용 사진을 이력에 남김 ④ 기존 근태 기능을 망가뜨리지 않을 것.
> 이전 버전(2026-07-10, 데모 앱 리서치)은 git 이력에 보존.

## 관련 파일과 역할

### 가져올 것 (liveness-demo — 검증 완료본)
| 파일 | 역할 | 비고 |
|---|---|---|
| liveness-demo/lib/liveness.ts | MiniFASNet 2모델 판독 모듈 | 전처리 상수 변경 금지(현황판 명시). webapp 경로 후보가 이미 들어있어 그대로 복사 가능 |
| liveness-demo/models/*.onnx (2개) | 모델 가중치 (~4MB) | webapp/models/로 복사 |
| liveness-demo/app/DemoClient.tsx | 촬영 설정 | **1280×720, JPEG 0.9(초과 시 0.75→0.6 재압축)** — 사장님이 테스트한 점수가 이 조건에서 측정됨 |
| liveness-demo/lib/gaonfr.ts detectFaces | 얼굴 위치 검출 | webapp에서는 **불필요** — recognize 응답에 FaceRect가 옴(2026-07-10 실측 확인, recognize·enrollment·detect 모두 반환) |

### 수정 대상 (webapp)
| 파일 | 현재 상태 | 필요한 변경 |
|---|---|---|
| app/actions/face.ts | faceClockIn/Out: verifyMyFace(recognize) 성공 → clockIn()/clockOut() | 출퇴근 처리 **후**에 판독+사진 저장을 덧붙임(후처리) |
| lib/face.ts recognizeFace | Similarity·FaceId만 반환. FaceRect 파싱(parseRect)은 enroll에서만 사용 | FaceRect·ImageSize를 **반환값에 추가**(추가만, 기존 필드 무변경) |
| prisma/schema.prisma | Attendance에 판독 관련 컬럼 없음 | 사진·점수 기록 모델 **추가만** |
| app/attendance/FaceClockPanel.tsx | 촬영 480px·JPEG 0.85 | 데모와 동일한 1280·0.9로 상향(기준값 일치 조건) |
| app/records/[userId]/page.tsx + DetailTable | 관리자 근태 상세 | 배지·점수·사진 열람 추가 |
| lib/dayentries.ts AttRow | 판독 필드 없음 | 선택 필드 추가 |

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳 — Grep 전수 확인)

1. **lib/face.ts `recognizeFace`** — 사용처 1곳: app/actions/face.ts `verifyMyFace`뿐. 선택 필드(faceRect·imageSize)만 추가하면 기존 동작 무변경. ⚠️ 현황판 "lib/face.ts 기존 함수 수정 금지" → **추가 전용 변경**임을 명시하고 승인 후 진행(safe-coding 절차).
2. **actions/attendance.ts `clockIn`/`clockOut`** — 사용처: ClockInPanel(일반 출근), FaceClockPanel(폴백 퇴근), actions/face.ts. 현황판 "수정 금지" → **수정하지 않는다.** 판독 결과는 호출 뒤 열린/방금 닫힌 Attendance 레코드를 찾아 별도 update로 연결.
3. **lib/dayentries.ts / DetailTable** — 사용처 3곳: records/[userId](관리자), **my-records(직원 본인)**, MonthCalendar. ⚠️ 직원 본인 화면에 같은 컴포넌트가 쓰임 → "조용한 표시" 원칙상 직원에게 보이면 안 됨. 선택 prop(기본 꺼짐)으로 관리자 페이지에서만 켠다.
4. **Attendance 모델** — 조회처 다수(dashboard, records, my-records, reports/export, corrections, worktime). 관계 모델 추가만 하므로 기존 조회(include 미지정) 무영향.
5. **GPS/일반 출퇴근** — 사진 자체가 없어 판독 비대상. 코드 경로 분리(ClockInPanel→clockIn 직행), 영향 없음.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- 공통 모듈: recognizeFace(1곳), buildDayEntries/DetailTable(3곳) → 추가 전용 + 기본값 유지로 방어.
- 변경 금지 확정: liveness.ts 전처리 상수(4.0/2.7·80×80·BGR·linear), clockIn/clockOut 본체, 기존 얼굴 성공/실패 판정 로직.

## DB·API 변경 여부, 위험 요소
- **DB**: 사진 기록 모델 신설 + Attendance 관계 추가(추가만, 기존 데이터 무영향, 마이그레이션 필요).
- **저장 사진 = 생체정보 원본**: 기존 확정 설계(2026-07-10)는 "의심건만 저장"이었으나 이번 지시는 "사용된 사진을 이력에 남김"(전건) → **저장 범위 확대는 법적 결정 사항.** 암호화(AES-256)·웹 공개경로 밖 저장·관리자만 열람(열람 기록)·보관기한 자동 파기·동의서 문구 반영이 전제.
- **기준값(threshold)**: 사장님 기준값 테스트 미완료. 차단이 없으므로 "재검토 필요" 배지 기준일 뿐 → 기본 50%, .env로 조정. 단 **촬영 조건(1280·0.9)을 데모와 동일하게** 맞춰야 데모에서 잰 점수와 비교 가능.
- **가용성**: 판독은 출퇴근 처리 완료 뒤 후처리 → 실패/시간초과가 출퇴근을 절대 막지 않음(상태 "error"+로그만).
- **얼굴인식 회귀**: 촬영 해상도 상향(480→1280)은 GaonFR 인식에도 같은 사진이 가므로 얼굴 출퇴근 회귀 테스트 필수. 서버액션 1MB 한도는 데모와 같은 재압축 로직으로 대응.

## 결론 (계획 시 고려사항)
1. 판독 = "출퇴근 처리 완료 후 덧붙는 후처리". 기존 함수 무수정, 실패해도 통과.
2. 얼굴 위치는 recognize 응답 FaceRect 재사용(추가 API 호출 불필요). 구현 중 실측 재확인, 없으면 판독 생략("error") 폴백.
3. 사진 전건 저장(확정 설계 대비 확대)과 보관기간은 사장님 확인 항목으로 계획서에 명시.
4. 등록 시 차단(기존 계획의 "부드러운 차단")은 이번 지시 범위 밖 → 제외하고 계획.
