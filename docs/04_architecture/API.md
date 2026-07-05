# API 설계 — 1차 MVP

> **작성일**: 2026-07-04 · **상태**: Draft (검토 게이트 대기 🚦)
> **근거**: [ERD.md](ERD.md), [face-spec.md](../07_ai/face-spec.md), [gps-spec.md](../07_ai/gps-spec.md), [screen-inventory.md](../03_design/screen-inventory.md)
> **규칙**: 화면 ↔ 데이터를 잇는 통로. 얼굴 관련은 **GaonFR 어댑터**를 거치며, 어댑터는 외부에 노출되지 않는 내부 모듈이다.

---

## 0. 공통 규칙
- 통신: **HTTPS 전용**. 인증: 로그인 토큰(관리형 인증). 권한: `admin`은 회사 범위, `employee`는 본인 범위.
- 멀티테넌트: 모든 요청은 로그인 사용자의 `company_id`로 자동 격리(다른 회사 데이터 접근 불가).
- 비밀값(GaonFR ClientToken 등)은 서버 env에만. 응답·로그에 노출 금지.

---

## 1. 인증 / 온보딩
| 기능 | 메서드/경로 | 입력 | 출력 | 화면 |
|---|---|---|---|---|
| 회사 회원가입 | `POST /api/companies` | 회사명, 이메일, 비번 | 회사·관리자 생성 | 4-2 |
| 로그인 | `POST /api/auth/login` | 이메일, 비번 | 토큰, role(분기용) | 4-3 |
| 회사 초기설정(온보딩) | `POST /api/company/setup` | 근무제, 사업장(좌표·반경), 5인이상 여부 | work_policy·worksite 생성 | 3-1 |

## 2. 직원 관리 (관리자)
| 기능 | 메서드/경로 | 입력 | 출력 | 화면 |
|---|---|---|---|---|
| 직원 목록 | `GET /api/employees` | 필터(부서/상태) | 직원 배열 | 3-3 |
| 직원 초대 | `POST /api/employees/invite` | 이메일(단건/복수) | 초대 발송 | 3-3 |
| 직원 상세 | `GET /api/employees/{id}` | - | 정보+인증방식+동의상태 | 3-3-1 |
| 직원 수정/퇴사 | `PATCH /api/employees/{id}` | 변경 필드 / 퇴사 | 갱신. **퇴사 시 파기 트리거** | 3-3-1 |

## 3. 얼굴 등록 · 동의 · 파기 (GaonFR 어댑터 경유)
| 기능 | 메서드/경로 | 입력 | 어댑터 호출 | 화면 |
|---|---|---|---|---|
| 생체정보 동의 | `POST /api/face/consent` | 동의 체크, 버전 | (없음) 동의 기록 | 1-2 |
| 얼굴 등록 | `POST /api/face/enroll` | 실시간 촬영 이미지 | → `enrollment`(Image,FaceId,Group) | 1-3 |
| 얼굴 삭제(철회) | `DELETE /api/face/enroll` | - | → `unenrollment`(FaceId[],Group) + 파기로그 | 2-2 |

> 동의(`consent`) 없이는 `enroll` 호출 불가(face-spec [6]). 이미지는 저장하지 않고 통과만.

## 4. 출퇴근 (얼굴/GPS)
| 기능 | 메서드/경로 | 입력 | 처리 | 화면 |
|---|---|---|---|---|
| 인증용 nonce 발급 | `POST /api/attendance/nonce` | - | 1회용 난수+유효시간(위조방지) | 1-6 |
| 얼굴 출퇴근 | `POST /api/attendance/face` | type, 이미지, nonce, (GPS 동시) | → `recognize`; 판정 통과 시 기록 | 1-6 |
| GPS 출퇴근 | `POST /api/attendance/gps` | type, 좌표, accuracy, nonce | 지오펜스 판정 후 기록 | 1-7 |
| 옵션 B 자리확인 | `POST /api/presence/sample` | 이미지 | → `detect`; present(있음/없음)만 기록 | 1-8 |

> 얼굴 선택자는 얼굴 AND GPS 동시확인 가능(face-spec [7-2], gps-spec [1-2]). 실패·장애 시 GPS 폴백.

## 5. 조회 / 리포트 / 법정기록
| 기능 | 메서드/경로 | 권한 | 화면 |
|---|---|---|---|
| 내 근태 조회 | `GET /api/me/attendance` | 직원(본인) | 2-1 |
| 근태 현황(전체) | `GET /api/attendance?기간·부서` | 관리자 | 3-4 |
| 직원별 근태 상세 | `GET /api/attendance/{userId}` | 관리자 | 3-3-1 |
| 실근무시간 리포트 | `GET /api/reports/worktime?단위·기간` | 관리자 | 3-5 (표) |
| 법정 근로기록 조회 | `GET /api/legal/records?기간(≤3년)` | 관리자 | 3-7 |
| 생체정보 동의·파기 현황 | `GET /api/face/status` | 관리자 | 3-6 |

## 6. 설정
| 기능 | 메서드/경로 | 화면 |
|---|---|---|
| 근무제·기준·임계값 | `GET/PUT /api/company/policy` | 3-1/설정 |
| 사업장(지오펜스) | `GET/POST /api/worksites` | 3-1 |
| 계정 설정(비번 변경) | `PUT /api/me/password` | 공통 |

---

## 7. 실근무시간 산식 (옵션 B) — 확정안
```
재실시간   = 마지막 퇴근 − 첫 출근
자리비움   = 주기 샘플에서 '없음'이 연속된 구간의 합
             (단, 1회성 '없음'은 오탐 방지를 위해 연속 2회 이상일 때만 자리비움으로 계산)
실근무시간 = 재실시간 − 자리비움
```
> 샘플링 주기 기본 10~15분(work_policy에서 조정). 오탐(잠깐 자리 비켜 얼굴 미검출)을 줄이기 위해 **연속 2회 이상 '없음'** 을 자리비움으로 본다. 최종 파라미터는 파일럿 실측으로 조정.

## 8. GaonFR 어댑터 (내부 전용, 외부 미노출)
`enroll/recognize/detect/unenroll`을 감싸는 단일 모듈. 토큰 발급·캐시·재발급(4016/401/403/429 시 1회 재시도), 비밀값 env, 이미지 pass-through(미저장). (face-spec [1] 참조)
