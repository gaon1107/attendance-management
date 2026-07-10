# Research: 라이브니스(사진 위조 판독) 적용 — 2026-07-10

## 근거 문서 (이미 완료된 조사·확정)
- [liveness-오픈소스-비교.md](docs/07_ai/liveness-오픈소스-비교.md): 채택 1순위 **MiniFASNet V1SE+V2 앙상블**(Apache-2.0), ONNX·CPU 구동, 예비 mn3
- PROGRESS 확정 결정(2026-07-10 사장님): **출퇴근=조용한 표시**("본인 확인 재검토 필요" 중립 문구 + 점수·시각·의심건 사진), **등록=부드러운 차단**, 의심 사진은 **암호화·관리자만·90일 파기**

## 아키텍처 선택 — B안(웹앱 내장)로 제안 (전문가 A안에서 조정)
전문가 보고서는 A안(별도 Python 마이크로서비스)을 1순위로 했으나, 우리 운영 현실(비개발자 운영, 프로세스 1개가 단순)을 반영해 **B안: Next.js 서버에 onnxruntime-node로 직접 내장**을 제안한다.
- **가능 근거 1 — 얼굴 위치(crop) 문제 해결**: MiniFASNet은 "얼굴 상자 기준 2.7배/4배 크롭"이 필요한데, 별도 얼굴검출기를 안 들여와도 **GaonFR 응답의 FaceRect를 그대로 쓰면 된다** (recognize·enrollment·detect 모두 FaceRect 반환 — 실측 확인 완료. sample02 모델 정의에도 명시)
- **가능 근거 2**: 모델 2개 합계 ~4MB, CPU 수십 ms — Node 프로세스 안에서 부담 없음. onnxruntime-node·sharp(이미지 크롭)는 Windows 지원되는 표준 npm 패키지
- 격리 원칙: 판독 코드는 `lib/liveness.ts` 한 모듈에만 두어, 추후 트래픽 증가 시 A안(별도 서비스)으로 떼어내기 쉽게 한다
- 모델 가중치: yakhyo/face-anti-spoofing 릴리스의 ONNX 2종을 `webapp/models/`에 커밋(각 ~2MB, Apache-2.0 — 출처·라이선스 명기)

## 적용 지점별 흐름
| 지점 | 흐름 | 차단? |
|---|---|---|
| **출퇴근** (faceClockIn/Out) | recognize 성공(본인 확인) → 응답 FaceRect로 크롭 → 판독 → 점수 기록. **의심이어도 출퇴근은 정상 처리**, Attendance에 의심 표시 + 그 사진 암호화 저장 | ❌ 조용한 표시 |
| **등록** (enrollMyFace) | enrollment 응답 FaceRect로 크롭 → 판독 → 의심 시 **방금 등록분 즉시 unenroll(롤백)** + "밝은 곳에서 다시 촬영해 주세요" | ✅ 부드러운 차단 |
| **관리자** | 근태현황·직원 근태상세에 "본인 확인 재검토 필요" 배지 → 클릭 시 점수·시각·사진 열람(열람 기록 남김) | — |

※ 등록은 detect 선호출 방식 대신 "등록 후 의심 시 롤백"을 택함 — GaonFR 호출 1회로 끝나고, 실패해도 잔존물이 남지 않음(unenroll 확인 실패 시 재시도).

## DB·저장 변경
- Attendance: `livenessStatus`(null/ok/suspect), `livenessScore`(Float?) — 출근·퇴근 각각? → 최소화: 출근/퇴근 중 **의심이 하나라도 있으면 표시**, 상세는 SuspectCapture로
- 신규 모델 `SuspectCapture`: userId, companyId, attendanceId?, kind(clock_in/clock_out/enroll), score, filePath, createdAt (+열람 로그 `viewedAt/viewedBy`는 단순화: AdminViewLog 대신 필드로 시작)
- 사진 파일: `webapp/private-data/suspect/`(웹 공개경로 밖) — **AES-256-GCM 암호화**(키=env `SUSPECT_PHOTO_KEY`), 90일 경과분은 저장/조회 시 자동 파기(lazy purge)
- ⚠️ "얼굴원본 미저장" 원칙의 확정된 예외(의심 건 한정) — face-spec §3-2에 예외 명시 필요

## 🔴 영향 범위
- actions/face.ts(faceClockIn/Out·enrollMyFace): 판독 로직 **추가** — 기존 성공/실패 판정 로직 무변경. 판독 자체가 실패(모델 오류 등)하면 **판독 없이 통과**(가용성 우선, 로그만)
- clockIn/clockOut·lib/face.ts 기존 함수: 무수정
- 근태현황·상세 화면: 배지 컬럼 추가(표시만)
- 스키마 추가만 → 마이그레이션 1회 + dev 서버 재시작 필요

## 위험 요소
1. 오판(진짜 사람을 의심 표시) — 조용한 표시 방식이라 직원 피해 없음. 임계값은 보수적으로 시작(의심 판정 기준 낮게) 후 PoC로 조정
2. 480px 압축 이미지는 판독 단서가 뭉개질 수 있음 → 얼굴 캡처를 **720p·저압축**으로 상향(서버액션 1MB 한도 내, ~150-300KB)
3. onnxruntime-node·sharp 설치 실패 가능성(네이티브 모듈) — 1단계에서 즉시 확인, 실패 시 A안(Python)으로 전환 보고
4. PoC(사진·화면·동영상 공격 테스트)는 사장님 웹캠 필요 — 구현 후 체크리스트로 함께 진행
