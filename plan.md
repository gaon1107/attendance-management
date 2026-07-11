# Plan: 라이브니스(사진판독) 근태 webapp 적용 (2026-07-11) — 상태: 검토 대기

> 사장님 지시 반영: **출·퇴근 시에만** 판독 / **차단 없음**(관리자 이력 확인용) / **출퇴근에 쓴 분석 사진을 이력에 저장** / 기존 근태 기능 무손상.
> 이전 계획(0단계 데모)은 완료 — git 이력에 보존. 데모 검증 결과: 진짜 99.5% vs 위조 6.7%, 사장님 폰사진 판별 성공.

## 1. 접근 방식 (+이유)
- **후처리 방식**: 얼굴 본인확인 → 출퇴근 처리(기존 코드 그대로) → **그 다음에** 판독+사진 저장. 판독이 실패하거나 늦어도 출퇴근은 이미 끝난 상태라 **기존 기능이 절대 막히지 않는다.**
- 판독 모듈·모델은 검증 끝난 liveness-demo 것을 **그대로 복사**(전처리 상수 무변경 — 점수 왜곡 방지).
- 얼굴 위치는 출퇴근 때 이미 호출하는 recognize 응답의 FaceRect 재사용 → **얼굴서버 추가 호출 없음**(속도·부하 이점).
- 직원 화면에는 아무 표시 없음(조용한 표시). 관리자 근태 상세에서만 점수·배지·사진 확인.

## 2. 수정/생성 파일 목록
| 구분 | 파일 | 내용 |
|---|---|---|
| 생성 | webapp/models/*.onnx (2개) | 데모에서 복사 (Apache-2.0, 출처 주석 유지) |
| 생성 | webapp/lib/liveness.ts | 데모 lib/liveness.ts 그대로 복사 (상수 무변경) |
| 생성 | webapp/lib/clock-photo.ts | 사진 AES-256 암호화 저장/복호 열람/보관기한 자동 파기 (웹 공개경로 밖 webapp/storage/) |
| 수정 | webapp/package.json | onnxruntime-node, sharp 추가 (데모와 동일 버전) |
| 수정 | prisma/schema.prisma | **추가만**: ClockPhoto 모델(출근/퇴근 구분, 점수, 판독상태, 파일경로, 열람기록) + Attendance 관계 |
| 수정 | webapp/lib/face.ts | recognizeFace 반환에 faceRect·imageSize **선택 필드 추가** (기존 필드·판정 무변경, 사용처 1곳뿐) |
| 수정 | webapp/app/actions/face.ts | faceClockIn/Out: 출퇴근 처리 후 판독+사진 저장 덧붙임 (실패 시 통과+로그) |
| 수정 | webapp/app/attendance/FaceClockPanel.tsx | 촬영 480→1280·품질 0.9 (데모 측정 조건과 일치 — 기준값 비교 전제) + 용량 초과 시 재압축 |
| 수정 | webapp/lib/dayentries.ts | AttRow에 판독 정보 선택 필드 추가 (기존 계산 무변경) |
| 수정 | webapp/app/components/DetailTable.tsx | 관리자 전용 선택 prop(기본 꺼짐): 점수·"본인 확인 재검토 필요" 배지·사진 보기 |
| 수정 | webapp/app/records/[userId]/page.tsx | ClockPhoto 함께 조회 + DetailTable에 관리자 prop 전달 |
| 생성 | webapp/app/api/clock-photo/[id]/route.ts | 관리자 전용 사진 열람(회사 격리 + 복호화 스트림 + 열람 기록) |
| 수정 | webapp/.env | LIVENESS_THRESHOLD(기본 0.5), CLOCK_PHOTO_KEY(암호화 키) — git 제외 유지 |

## 3. 🛡️ 사이드 이펙트 방어
- **수정 금지 준수**: clockIn/clockOut 본체, liveness 전처리 상수, 기존 얼굴 성공/실패 판정 → 전부 무수정. 판독 결과는 출퇴근 뒤 해당 Attendance 레코드를 찾아 별도 저장.
- **공통 모듈 방어**: recognizeFace(사용처 1곳)·DetailTable/dayentries(3곳, my-records 포함)는 선택 필드/prop **추가만** — 기본값이 기존 동작. 직원 본인 화면(my-records)·달력(MonthCalendar)은 켜지 않아 변화 없음.
- **가용성**: 판독/저장 전체를 try-catch로 감싸 실패해도 출퇴근 메시지 정상 반환(상태 "error" 기록+서버 로그).
- 구현 후 회귀 테스트: ① 얼굴 출근/퇴근(해상도 상향 후 인식 정상 여부 — 중요) ② GPS/일반 출퇴근 ③ 근태현황·내근태·달력 표시 ④ 리포트 내보내기 ⑤ 얼굴 등록(무변경 확인)
- 저장 공간: 1장 ~100-200KB × 출퇴근 2회/일 — 직원 10명 기준 월 ~100MB 수준, 파기 주기로 상한 유지.

## 4. 법적 안전장치 (✅ 사장님 확정 2026-07-11)
- ✅ **확정 1 — 저장 범위**: 출퇴근 사진 **전건** 이력 저장.
- ✅ **확정 2 — 보관기간**: **90일 보관 후 자동 삭제** (출퇴근 시각 기록은 3년 보존, 사진만 파기).
- ✅ **확정 3 — 동의 항목 추가**: 직원 생체정보 동의 화면(app/consent/page.tsx)에 "출퇴근 시 촬영 사진을 본인 확인 재검토 목적으로 90일 보관 후 자동 삭제" 안내 상자를 추가하고, 이 내용을 포함해 동의를 받는다.
- 표기 문구: **"본인 확인 재검토 필요"**(단정 금지) — 기준값 미만일 때만 배지. 직원 화면 표시 없음.
- 사진 보호: AES-256 암호화, 웹 공개경로 밖 저장, 관리자만 열람 + 열람 기록, 90일 자동 파기.
- ※ 참고: 동의 문구가 바뀌므로 **이미 동의한 사용자는 원칙상 재동의 대상** — 현재는 테스트 계정뿐이라 실영향 없음. 실운영 전 전문가 검토 목록(동의 문안)에 이미 등록돼 있음.

## 5. 작업분해 TODO
- [ ] 1) 모듈 이식: models 2개 + lib/liveness.ts 복사, onnxruntime-node·sharp 설치, webapp에서 로드 확인 — 파일: webapp/models, webapp/lib/liveness.ts
- [ ] 2) DB: ClockPhoto 모델 추가 + 마이그레이션 (기존 데이터 무영향 확인) — 파일: prisma/schema.prisma
- [ ] 3) 사진 저장소: 암호화 저장/복호/자동 파기 모듈 + 저장 폴더 git 제외 — 파일: webapp/lib/clock-photo.ts
- [ ] 4) recognizeFace에 faceRect 선택 필드 추가 + 실측 확인(FaceRect 안 오면 판독 생략 폴백) — 파일: webapp/lib/face.ts
- [ ] 5) 출퇴근 후처리 연결: faceClockIn/Out에서 판독+사진 저장 (실패=통과) — 파일: webapp/app/actions/face.ts
- [ ] 6) 촬영 상향: 1280·0.9 + 재압축 (데모와 동일) — 파일: FaceClockPanel.tsx
- [ ] 7) 관리자 화면: 근태 상세에 점수·배지·사진 보기 + 열람 API(회사 격리·열람 기록) — 파일: DetailTable, records/[userId], api/clock-photo
- [ ] 8) 동의 화면에 "출퇴근 사진 90일 보관 후 자동 삭제" 항목 추가 + face-spec 반영 — 파일: webapp/app/consent/page.tsx(BOXES 문구), docs/07_ai/face-spec.md
- [ ] 9) 회귀 테스트 5종(§3) 실행 + 증거 확보
- [ ] 10) code-reviewer 검수 + project-status.md 갱신 + 커밋

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- **등록 시 판독 차단**(기존 계획의 "부드러운 차단") — 이번 지시가 "출퇴근 시에만"이므로 제외. 필요 시 별도 건.
- GPS/일반 출퇴근에 사진 촬영 추가 — 지시 범위 밖(사진이 원래 없음).
- 판독 점수에 따른 출퇴근 차단/경고 — "확인만" 원칙.
- 3조각(실근무 확인) — 계속 보류(사장님 지시).
- 기준값 정밀 캘리브레이션 — 배지 기준일 뿐이므로 기본 50%로 시작, 운영하며 .env로 조정.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
