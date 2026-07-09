# 프로젝트 현황판 (최종: 2026-07-09)

> 세부 이력은 PROGRESS.md가 원본. 이 파일은 "지금 하는 작업"의 현황판.

## 현재 상태: 구현완료·검수 재확인 중
- 마지막 작업: 얼굴로 출퇴근 인식(2조각) 구현 + code-reviewer 1차 검수 지적사항(치명1·중간3) 수정
- 다음 할 일: 재검수 통과 → git 커밋 → 사장님 웹캠 실검증(얼굴 등록→얼굴 출근→얼굴 퇴근)

## 완료된 기능
- 근태 MVP 전체(출퇴근·외출·위치·리포트·휴가·공지·부서·정정·달력·초과근무·알림·투어·PWA) — PROGRESS.md 참고
- 얼굴인증 1조각 = 얼굴 등록(셀프, 최대 3회, 삭제·리셋) 완료·검증 (2026-07-09)
- 얼굴인증 2조각 = 얼굴로 출퇴근(recognize 본인확인→기존 출퇴근 재사용, 일반방식 대체 버튼) 코드 완료 (2026-07-09)

## 진행 중인 기능 (TODO 진행도)
- 얼굴로 출퇴근 인식(2조각): 6/6 구현·검수수정 완료, 재검수·실웹캠 검증 대기

## ⚠️ 알려진 이슈
- **DB상 등록된 얼굴 없음** (admin=얼굴 선택했지만 등록 0회 — 삭제 테스트로 초기화). 실검증 전 /face-enroll에서 재등록 필요
- 유사도(Similarity) 하한선 미적용 — 실서버 응답 형식 확인 후 추가 예정
- 라이브니스(사진 위조 방지) 미지원 — 보완책은 보안 단계 설계
- 얼굴서버 login/get-token 요청(기존 코드)에는 타임아웃 없음 — recognize에만 10초 적용(기존 함수 무수정 원칙)
- 테스트 직원(박성헌) 근무요일이 토·일로 설정돼 있음(테스트 흔적)

## 🚧 건드리면 안 되는 부분
- `webapp/app/actions/attendance.ts`의 clockIn/clockOut 내부 로직: 검증 완료 — 재사용만, 수정 금지
- `webapp/lib/face.ts`의 enrollFace/unenrollFace: 등록 기능 검증 완료 — 수정 금지
- `webapp/.env`의 FACE_* 4개: 비밀값, git 제외 유지

## 영향 범위 지도
- attendance/page.tsx ↔ ClockInPanel.tsx / FaceClockPanel.tsx ↔ actions/attendance.ts·actions/face.ts: 출퇴근 흐름
- actions/face.ts ↔ lib/face.ts: 얼굴서버 연동(등록/삭제/인식)
- FaceClockPanel.tsx → ClockInPanel.tsx를 대체 수단으로 내부 렌더링(일반 출근)
- reports·records·dashboard 등 11개 파일: Attendance 데이터 읽기 전용(구조 변경 없어 영향 없음)
