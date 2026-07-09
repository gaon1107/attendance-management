# Research: 얼굴로 출퇴근 인식 (2조각) — 2026-07-09

## 목표
직원이 [출퇴근] 화면에서 출근/퇴근할 때 **웹캠으로 얼굴을 찍어 본인 확인** 후 처리한다.
(얼굴인증을 선택하고 얼굴을 등록한 직원만. GPS 직원은 지금 그대로.)

## recognize API 형식 — 확인 완료 ✅
출처: `newgaon-LMS/GFKids app/docs/api/sample소스/sample02.js` (가온 공식 데모)

- **주소**: `POST {서버}/v1/face/recognize/`
- **헤더**: `ApiToken` (기존 등록과 동일한 2단계 토큰)
- **본문**: multipart FormData — `Image`(사진 파일) + `Group`(회사 id)
  → **등록(enrollment)과 완전히 같은 형식.** JSON 본문 아님.
- **응답**: JSON(PascalCase) — `Faces: [{ FaceId, Similarity, FaceRect, ... }]`
  - 인식 성공 = 얼굴 1개 + `FaceId`가 `"Unknown"`이 아님 (서버가 자체 유사도 기준으로 판정)
  - 우리 쪽 추가 검증: **`FaceId` == 로그인한 직원 id** (다른 사람 얼굴로 출근 방지)
- **토큰 만료**: StatusCode 4016 → ApiToken 재발급 후 1회 재시도 (기존 enrollFace와 동일 패턴)
- **429(요청 과다)**: 데모는 잠시 후 재시도 처리 — 우리는 "잠시 후 다시" 안내로 처리

## 관련 파일과 역할
| 파일 | 역할 |
|---|---|
| `webapp/lib/face.ts` | 얼굴서버 연동(로그인→토큰→enroll/unenroll). **recognize만 없음** |
| `webapp/app/actions/face.ts` | 서버 액션: 등록(enrollMyFace)/삭제(deleteMyFace) |
| `webapp/app/face-enroll/FaceCapture.tsx` | 웹캠 촬영 UI(카메라→촬영→미리보기→전송) — **인식 화면에서 패턴 재사용** |
| `webapp/app/attendance/page.tsx` | 출퇴근 화면(서버). 출근=ClockInPanel, 퇴근=form action={clockOut} |
| `webapp/app/attendance/ClockInPanel.tsx` | 출근 버튼 3개(사무실/재택/외근), 사무실은 GPS 좌표 수집 |
| `webapp/app/actions/attendance.ts` | clockIn(중복방지+위치판정)/clockOut(외출 자동복귀) |

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳)
- `clockIn`/`clockOut` 사용처 전수검색 결과: **ClockInPanel.tsx / attendance/page.tsx 두 곳뿐.**
  (reports·records·dashboard 등 11개 파일은 Attendance **데이터**만 읽음 — 데이터 구조를 안 바꾸므로 영향 없음)
- `lib/face.ts` 사용처: `actions/face.ts` 한 곳. 기존 함수는 손대지 않고 **recognizeFace 함수 추가만** → 기존 등록/삭제 기능 영향 없음.
- `faceEnrolledAt`/`authMethod`를 읽는 화면(대시보드·직원관리·biometrics 등)은 읽기만 하므로 영향 없음.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- `lib/face.ts`는 공통 모듈이지만 **기존 함수 수정 없음, 추가만** → safe-coding 옵션 불필요.
- `clockIn`/`clockOut` 로직은 **수정하지 않고 재사용**(얼굴 확인 후 서버 안에서 호출). 위치판정·중복방지 로직 그대로 유지.

## DB·API 변경 여부, 위험 요소
- **DB 스키마 변경 없음** (마이그레이션 없음 → dev 서버 재시작 불필요).
- 위험 요소:
  1. **(알림만) 얼굴 직원이 얼굴을 건너뛰고 일반 출근을 호출할 이론적 우회 가능** — 서버가 "얼굴 인증 완료"를 출근의 필수조건으로 강제하지는 않음(GPS 직원과 같은 clockIn 사용). MVP에선 화면에서 얼굴 흐름만 보여주는 것으로 하고, 강제화(서버측 검증표시 저장)는 추후 확장으로 기록.
  2. 얼굴서버(개발 gaonfrdev)가 꺼져있거나 느릴 수 있음 → 실패 시 명확한 안내 + GPS(일반) 출근으로 대체 가능해야 함(얼굴 강제 금지 원칙과도 일치).
  3. 서버 액션 본문 1MB 제한 → 등록과 동일하게 480px JPEG 축소 전송(기존 패턴 재사용).

## 결론 (계획 시 고려사항)
- recognize는 등록과 같은 multipart 형식이라 `lib/face.ts`에 recognizeFace 추가는 기존 enrollFace를 본뜨면 됨.
- 본인확인의 핵심 = 응답 `FaceId == 직원 id` && `FaceId != "Unknown"`.
- 얼굴 확인과 출근 처리를 **한 서버 액션 안에서** 처리(확인 성공 → 기존 clockIn/clockOut 호출)하면 화면에서 조작으로 건너뛸 수 없음.
- 얼굴은 선택 수단(강제 금지) → 얼굴 실패 시에도 일반 출근 버튼 제공.
