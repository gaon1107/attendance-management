# 데이터 구조 설계 (ERD) — 1차 MVP

> **작성일**: 2026-07-04 · **작성**: 총괄(메인) · **상태**: Draft (검토 게이트 대기 🚦)
> **근거**: [requirements.md](../02_prd/requirements.md), [face-spec.md](../07_ai/face-spec.md), [gps-spec.md](../07_ai/gps-spec.md), [CLAUDE.md](../../CLAUDE.md)
> **전제**: 관리형 백엔드/DB(A안), 멀티테넌트(회사별 칸막이), 얼굴 원본은 GaonFR 보관·우리는 참조값만.

---

## 0. 한 장 요약 (비개발자용)

- **회사(테넌트)** 밑에 **직원**과 **사업장(위치)**, **근무제 설정**이 달린다.
- 직원이 출퇴근하면 **출퇴근 기록**이 쌓이고, 근무 중 옵션 B는 **자리 기록(있음/없음)** 으로 남는다. 이 둘로 **실근무시간**이 계산된다.
- 얼굴 관련 테이블은 **참조·동의·파기 이력만** 담는다. **얼굴 사진·특징값은 우리 DB에 없다**(GaonFR 보관).
- 법정 근로기록은 **출퇴근 기록을 3년 보존**하는 것으로 충족한다.

---

## 1. 전체 관계도 (텍스트 ERD)

```
company (회사·구독)
 ├─1:N─ user (직원/관리자)
 │        ├─1:1─ face_enrollment (얼굴 등록 참조)   ── GaonFR FaceId 연결(원본 아님)
 │        ├─1:1─ biometric_consent (생체정보 동의 상태)
 │        ├─1:N─ destruction_log (파기 이력)
 │        ├─1:N─ attendance_record (출퇴근 기록)      ── 법정 3년 보존 대상
 │        ├─1:N─ presence_sample (옵션 B 자리 기록)
 │        └─1:N─ worktime_daily (일별 실근무시간 집계)
 ├─1:N─ worksite (사업장·지오펜스)
 └─1:1─ work_policy (근무제·기준시간·임계값 설정)
```

---

## 2. 테이블 상세 (P0)

### 2-1. company (회사 / 구독 / 테넌트)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | 회사 고유 id |
| name | 문자열 | 회사명 |
| group_key | 문자열(고유) | **GaonFR `Group` 값** (회사별 얼굴 칸막이 식별자) |
| is_five_plus | 불리언 | 5인 이상 사업장 여부(법정 기록 자동 적용) |
| subscription_status | 문자열 | 구독 상태(파일럿 기간은 `pilot`/무료). 결제는 P1 |
| created_at | 시각 | 생성일 |

### 2-2. user (직원 / 관리자)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | 직원 고유 id. **GaonFR `FaceId`로도 사용**(문자열) |
| company_id | FK→company | 소속 회사 |
| role | enum | `admin` / `employee` |
| name, dept, position | 문자열 | 이름·부서·직급 |
| email | 문자열 | 로그인·초대용 |
| status | enum | `invited` / `active` / `resigned` |
| auth_method | enum | `face` / `gps` (직원이 선택, 변경 가능) |
| created_at | 시각 | |

### 2-3. worksite (사업장 / 지오펜스)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| company_id | FK→company | |
| name, address | 문자열 | 사업장명·주소 |
| lat, lng | 실수 | 사업장 중심 좌표 |
| radius_m | 정수 | 허용 반경(미터). 기본 예: 100~200 |
| allowed_ip_ranges | 문자열[] | (보조확인) 사내 IP 대역 — 실내 오차 보완용, 선택 |
| is_active | 불리언 | 사용 여부 |

> 다중 사업장은 P2지만, 구조상 company 1:N worksite로 미리 열어둠(하나라도 반경 이내면 통과).

### 2-4. work_policy (근무제 / 기준 / 임계값)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| company_id | FK→company | 회사당 1개(1:1) |
| standard_start, standard_end | 시각 | 표준 근무시간(지각/조퇴 기준) |
| realwork_sampling_min | 정수 | 옵션 B 자리확인 주기(분). 예: 10~15 |
| similarity_threshold | 실수 | 얼굴 인식 통과 임계값(파일럿 실측 후 확정) |
| gps_accuracy_threshold_m | 정수 | GPS 정확도 허용 임계값 |
| aux_check_policy | enum | 보조확인 정책(A/B/C, gps-spec 근거) |

### 2-5. face_enrollment (얼굴 등록 — 참조만)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| user_id | FK→user | |
| face_id | 문자열 | GaonFR FaceId(=user.id와 동일 문자열) |
| group_key | 문자열 | GaonFR Group(=company.group_key) |
| enrolled | 불리언 | 등록 완료 여부 |
| enrolled_at | 시각 | |

> ❌ 얼굴 이미지/특징값 필드는 **없음**(GaonFR 보관). 여기엔 연결 정보·상태만.

### 2-6. biometric_consent (생체정보 동의)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| user_id | FK→user | |
| consented | 불리언 | 동의 여부 |
| consented_at | 시각 | 동의 일시(증빙) |
| consent_version | 문자열 | 동의서 버전 |
| withdrawn_at | 시각/null | 철회 일시 |

### 2-7. destruction_log (파기 이력 — 감사용)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| user_id | FK→user | |
| reason | 문자열 | 퇴사/철회/직원요청 |
| actor_id | FK→user | 처리자(관리자 등) |
| result | enum | `success` / `retry_pending` |
| created_at | 시각 | 파기 시각(얼굴 자체가 아니라 "언제 파기했다" 로그) |

### 2-8. attendance_record (출퇴근 기록 — 법정 3년 보존)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| user_id | FK→user | |
| company_id | FK→company | (조회 성능·테넌트 분리) |
| worksite_id | FK→worksite/null | 판정된 사업장 |
| type | enum | `check_in` / `check_out` |
| method | enum | `face` / `gps` / `manual` |
| face_ok, gps_ok | 불리언 | 각 확인 통과 여부(동시확인 대응) |
| manual_flag | 불리언 | 관리자 수동 보정 여부 |
| occurred_at | 시각 | 출퇴근 시각(기록 핵심) |
| created_at | 시각 | 저장 시각 |

> **법정 기록 = 이 테이블을 3년 보존**. 별도 테이블을 만들지 않고 보존정책으로 충족(F-08).
> ⚠️ GPS 원본좌표 저장 여부는 [5] 보안·법무에서 결정(gps-spec). 기본은 판정결과·시각·사업장만.

### 2-9. presence_sample (옵션 B 자리 기록 — 이미지 없음)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| user_id | FK→user | |
| sampled_at | 시각 | 확인 시각 |
| present | 불리언 | 있음/없음 (**신원·이미지 저장 안 함**) |

### 2-10. worktime_daily (일별 실근무시간 집계)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | PK | |
| user_id | FK→user | |
| work_date | 날짜 | |
| first_in, last_out | 시각 | 첫 출근/마지막 퇴근 |
| away_minutes | 정수 | 자리비움 합(presence_sample 기반) |
| real_work_minutes | 정수 | 실근무시간 = 재실시간 − 자리비움 |

> 실근무시간 **산식**(옵션 B '없음' 구간 처리 방식)은 [API/아키텍처]에서 확정.

---

## 3. 개인정보/보안 관점 요약
- 생체정보 원본: **우리 DB에 없음**(GaonFR). 우리는 참조·동의·파기 로그만.
- 위치: 판정 결과·시각·사업장 중심. 이동경로 미저장(gps-spec 원칙).
- 멀티테넌트: 모든 조회는 `company_id`(및 GaonFR `group_key`)로 회사 격리.
- 보존: 출퇴근 기록 3년(법정). 파기 이력은 감사 목적 보존.

## 4. 다음 단계로 넘기는 것
- 실근무시간 정확 산식·옵션 B 샘플링 기본값 → API/아키텍처 문서.
- GPS 원본좌표 보관 여부, 얼굴 임계값 등 잠정값 → [5] 보안·법무 + 파일럿 실측.
