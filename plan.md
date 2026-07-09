# Plan: 얼굴로 출퇴근 인식 (2조각) — 2026-07-09 · 상태: 구현 완료·검수 중

## 1. 접근 방식 (+이유)
- **얼굴 확인 + 출근 처리를 서버에서 한 번에**: 새 서버 액션 `faceClockIn`/`faceClockOut`이
  ① 사진을 얼굴서버 recognize에 보내 ② `FaceId == 본인 id` 확인 ③ 성공 시 **기존 clockIn/clockOut을 그대로 호출**.
  → 위치판정·중복방지 등 검증된 기존 로직을 재사용하고, 화면 조작으로 얼굴 확인을 건너뛸 수 없음.
- **화면은 기존 등록 화면(FaceCapture) 패턴 재사용**: 카메라 → 촬영 → 전송. 인식은 미리보기 없이 촬영 즉시 확인(빠른 출근).
- **얼굴은 선택 수단(법적 원칙)**: 얼굴인증 직원에게도 "일반 방식으로 출근" 대체 버튼을 항상 함께 표시.

## 2. 수정/생성 파일 목록
| 구분 | 파일 | 내용 |
|---|---|---|
| 수정 | `webapp/lib/face.ts` | `recognizeFace(image, group)` **추가만** (multipart Image+Group, ApiToken, 4016 재시도 — enrollFace 본뜸) |
| 수정 | `webapp/app/actions/face.ts` | `faceClockIn(formData)`·`faceClockOut(formData)` 추가 — 본인확인 후 기존 clockIn/clockOut 호출 |
| 생성 | `webapp/app/attendance/FaceClockPanel.tsx` | 얼굴인증 직원용 출근/퇴근 패널(웹캠 모달: 근무형태 선택→GPS수집→촬영→확인→처리) |
| 수정 | `webapp/app/attendance/page.tsx` | 얼굴 직원(authMethod=face && 등록완료)이면 FaceClockPanel, 아니면 기존 그대로 |

DB 스키마 변경 **없음** · 마이그레이션 없음 · dev 서버 재시작 불필요.

## 3. 🛡️ 사이드 이펙트 방어
- **영향받을 수 있는 기능**: 출퇴근(일반 GPS/IP 방식) — 얼굴 직원이 아닌 사용자 화면은 코드 분기로 기존 그대로 유지.
- clockIn/clockOut 함수는 **수정하지 않음**(호출만 추가) → 리포트·대시보드·정정 등 11개 파일 영향 없음.
- lib/face.ts 기존 함수(enroll/unenroll) 무수정 → 얼굴 등록/삭제 기능 영향 없음.
- **구현 후 반드시 테스트할 기존 기능**:
  1. GPS 직원(또는 인증방식 미선택)의 일반 출근/퇴근이 그대로 되는지
  2. 얼굴 등록 화면(/face-enroll)이 그대로 되는지
  3. 출근 후 외출/복귀/퇴근 흐름

## 4. 작업분해 TODO
- [x] 1단계: `lib/face.ts`에 recognizeFace 추가 (+10초 타임아웃·한국어 오류 안내) ✅
- [x] 2단계: `actions/face.ts`에 faceClockIn/faceClockOut 추가 (좌표 null 안전 처리) ✅
- [x] 3단계: FaceClockPanel(웹캠 출퇴근 UI) 생성 (더블클릭 차단·웹캠 종료 보강) ✅
- [x] 4단계: 출퇴근 화면 분기 연결 + 얼굴 미등록 안내 배너 ✅
- [x] 5단계: 검증 — tsc 통과, 브라우저 확인(얼굴 패널·대체 버튼·카메라 거부 안내·비얼굴 사용자 기존 화면 유지). ⚠️ 실제 얼굴 인식 E2E는 사장님 웹캠 필요(DB상 등록된 얼굴 없음 — 삭제 테스트로 초기화된 상태)
- [x] 6단계: code-reviewer 검수 — 치명1·중간3 발견 → 즉시 수정 → 재검토 진행 중 ✅(1차)

## 5. 핵심 로직 샘플 (계획용, 실제 구현 아님)
```ts
// lib/face.ts
export async function recognizeFace(imageBuffer: Buffer, group: string) {
  // FormData: Image + Group, 헤더 ApiToken, POST /v1/face/recognize/
  // 응답 Faces[0].FaceId가 "Unknown"이 아니면 { success:true, faceId, similarity }
}

// actions/face.ts
export async function faceClockIn(formData: FormData) {
  const me = await getCurrentUser();            // 로그인 + 얼굴등록 여부 확인
  const r = await recognizeFace(buffer, me.companyId);
  if (!r.success || r.faceId !== me.id) return { ok:false, message:"본인 얼굴로 확인되지 않았습니다." };
  await clockIn(mode, lat, lng);                // 기존 로직 재사용
  return { ok:true, message:"얼굴 확인 완료! 출근 처리되었습니다." };
}
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- **외출/복귀의 얼굴 확인** — 사장님 지시 범위는 출근/퇴근만.
- **얼굴 인증 강제화(서버에서 얼굴 직원의 일반 출근 차단)** — 얼굴 강제 금지 원칙 + MVP 범위 밖. 추후 "인증수단 기록" 확장으로.
- **라이브니스(사진 위조 방지)** — GaonFR 미지원(기확인). 보완책은 보안 단계에서 별도 설계.
- **자동 연속 인식(1초마다 자동 촬영)** — 1차는 수동 촬영+재시도. 사용해보고 불편하면 개선.
- **실근무시간 얼굴검출 샘플링(3조각)** — 다음 조각.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
