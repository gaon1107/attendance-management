# Walking Skeleton 구현 계획서 (bkend.ai 기반) — 사장님 승인용

> **작성일**: 2026-07-04 · **상태**: 승인 대기 🚦
> **목적**: 코드를 쓰기 전에, "무엇을 어떤 순서로 만들 것인가"를 비개발자가 읽고 판단할 수 있게 정리한 문서.
> **범위 (딱 이만큼만)**: 회사 회원가입 → 로그인 → (관리자) 직원 등록/목록 → (직원) GPS 출퇴근 → (관리자) 오늘 근태 대시보드
> **범위 밖 (이번엔 안 함)**: 얼굴인증, 옵션 B(자리확인), 실근무시간 리포트, 결제, 지각/휴가 신청 등. 이 문서는 ERD.md·API.md 전체 중 "제일 얇은 한 줄기"만 다룬다.

---

## 0. 한 장 요약 (비개발자용)

- **Walking skeleton**이란 "화려하지 않아도 처음부터 끝까지 실제로 동작하는 가장 얇은 뼈대"를 말한다. 화면은 예쁘지 않고 기능도 최소지만, **회원가입한 회사가 실제로 직원을 등록하고, 그 직원이 실제로 GPS로 출퇴근을 찍고, 관리자가 그걸 실제로 확인하는** 흐름이 눈으로 보이게 만드는 것이 목표다.
- 백엔드(서버·DB·로그인)는 **bkend.ai**라는 서비스를 빌려 쓴다. 서버를 직접 만들지 않고, "이미 만들어진 부품"에 우리 데이터 구조만 설정해서 쓰는 방식이다. 이렇게 하면 서버 운영 부담 없이 빠르게 첫 동작을 확인할 수 있다.
- 이 문서 승인 후 바로 이어서 **① bkend.ai 프로젝트 준비 → ② 데이터 테이블 생성 → ③ 회원가입/로그인 → ④ 직원 등록 → ⑤ GPS 출퇴근 → ⑥ 대시보드** 순서로, 각 단계가 끝날 때마다 사장님이 눈으로 확인할 수 있는 결과물을 만든다.

---

## 1. bkend.ai 데이터 모델 (ERD 부분집합 매핑)

ERD.md의 전체 테이블 중, 스켈레톤에 필요한 5개만 가져온다. 얼굴·옵션B·근무제 세부값 등은 이번엔 만들지 않는다.

### 1-1. bkend.ai 개념 정리 (처음 보는 용어 풀이)

| bkend.ai 용어 | 쉬운 말 |
|---|---|
| 프로젝트(Project) | 우리 서비스 하나를 담는 그릇. "근태관리" 프로젝트 1개를 만든다 |
| 환경(Environment) | 같은 프로젝트 안에서 개발용/실서비스용 데이터를 분리하는 서랍. 처음엔 `dev` 하나만 쓴다 |
| 테이블(Table) | 엑셀 시트 하나라고 생각하면 된다. 예: 직원 명단 시트, 사업장 시트 |
| 필드(Field) | 시트의 열(컬럼). 예: 이름, 이메일, 부서 |
| RLS(Row Level Security) | "이 시트의 어느 줄을 누가 볼 수 있나"를 정하는 규칙. 우리는 이걸로 "회사 A 관리자는 회사 A 직원 줄만 본다"를 강제한다 |
| Auth(인증) | bkend.ai가 기본 제공하는 로그인 기능. 이메일+비밀번호로 가입/로그인하면 자동으로 "이 사람이 누구인지 증명하는 토큰"을 준다 |

### 1-2. 테이블 설계 (스켈레톤 4개)

| 테이블명 | ERD 대응 | 역할 | 비고 |
|---|---|---|---|
| `company` | company | 회사(테넌트) 정보 | bkend.ai `user` 테이블과는 별도의 우리 커스텀 테이블 |
| `employee` | user | 직원(관리자 포함) 정보 | bkend.ai 로그인 계정(Auth User)과 **1:1 연결**되는 우리 커스텀 테이블 |
| `worksite` | worksite | 사업장 좌표·반경 | 지오펜스 판정 기준 |
| `attendance_record` | attendance_record | 출퇴근 기록 | 스켈레톤에선 GPS만, `face_ok`·`method`는 필드는 두되 값은 `gps`만 사용 |

> `work_policy`는 이번엔 만들지 않는다. 대신 `worksite.radius_m`(허용 반경)만 최소로 넣어 GPS 판정에 쓴다. 근무 시작/종료 시각, 실근무시간 기준값 등은 2차(옵션B) 단계에서 추가.

### 1-3. 필드 상세

**company**
| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | String | 자동생성 | bkend 기본 제공 |
| name | String | required | 회사명 |
| is_five_plus | Boolean | default: true | 5인 이상 사업장 여부(법정기록 표시용, 스켈레톤엔 값만 저장) |
| createdAt | Date | 자동생성 | bkend 기본 제공 |

**employee**
| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | String | 자동생성 | |
| company_id | String | required | **회사 격리의 핵심 키** — company.id 참조 |
| bkend_user_id | String | required, unique | bkend.ai Auth User의 id (로그인 계정과 연결) |
| role | String | required, default: "employee" | `admin` 또는 `employee` |
| name | String | required | 이름 |
| email | String | required, unique | 로그인·초대용 |
| status | String | default: "invited" | `invited` / `active` |
| createdAt | Date | 자동생성 | |

> ⚠️ `role`은 Enum 타입이 있으면 Enum(`admin`/`employee`)으로, 없으면 String + 애플리케이션 검증으로 처리한다(bkend.ai 실제 스키마 에디터에서 확인 후 결정).

**worksite**
| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | String | 자동생성 | |
| company_id | String | required | 회사 격리 키 |
| name | String | required | 사업장명 |
| lat | Number | required | 위도 |
| lng | Number | required | 경도 |
| radius_m | Number | default: 100 | 허용 반경(m) |

**attendance_record**
| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| id | String | 자동생성 | |
| company_id | String | required | 회사 격리 키(조회 성능용) |
| employee_id | String | required | employee.id 참조 |
| worksite_id | String | optional | 판정된 사업장 |
| type | String | required | `check_in` / `check_out` |
| method | String | default: "gps" | 스켈레톤엔 `gps` 고정 |
| gps_ok | Boolean | required | 지오펜스 통과 여부 |
| occurred_at | Date | required | 출퇴근 시각 |
| createdAt | Date | 자동생성 | |

### 1-4. 멀티테넌트 격리 방식 (중요 — 회사 간 데이터가 섞이면 안 됨)

- 모든 커스텀 테이블(`employee`, `worksite`, `attendance_record`)에 **`company_id` 필드를 반드시 포함**한다.
- bkend.ai의 **RLS(Row Level Security) 행 필터(rowFilters)** 기능을 각 테이블에 설정해서, 로그인한 사람의 `company_id`와 일치하는 행만 보이도록 서버 단에서 강제한다. (프론트엔드 코드 실수로 필터를 빼먹어도 서버가 막아준다 — 이게 핵심 안전장치)
- 즉, "관리자 화면에서 다른 회사 직원이 보인다" 같은 사고를 **DB 규칙 자체로 방지**한다. (docs/08_security/review.md의 "모든 쿼리에 테넌트 필터 강제" 요건을 여기서 충족)
- 실제 필터 표현식은 bkend.ai MCP `backend_field_manage` / RLS 설정 시 아래와 같은 형태가 된다(정확한 문법은 구현 착수 시 MCP `search_docs`로 재확인):
  ```json
  { "rowFilters": [ { "expression": "employee", "filter": { "company_id": "$company_id" } } ] }
  ```

---

## 2. 인증/권한 (Auth)

### 2-1. 두 종류의 "계정"이 있다는 점 — 헷갈리기 쉬운 부분

bkend.ai에는 로그인 계정 자체(Auth User, 이메일+비밀번호)와 우리 서비스의 "직원" 데이터(employee 테이블)가 **분리**되어 있다. 이 둘을 연결하는 다리가 `employee.bkend_user_id` 필드다.

| 구분 | 무엇인가 | 어디 저장 |
|---|---|---|
| Auth User | 로그인용 계정(이메일/비번, 토큰 발급) | bkend.ai 내장 인증 시스템 |
| employee 레코드 | 회사 소속·역할(admin/employee)·이름 등 업무 데이터 | 우리가 만든 `employee` 테이블 |

### 2-2. 회사(관리자) 가입 흐름

1. 관리자가 회사 회원가입 화면에서 회사명·이메일·비밀번호 입력
2. `POST /v1/auth/email/signup` 호출 → bkend.ai Auth User 생성, 토큰 발급
3. 곧바로 `POST /v1/data/company` 호출 → company 레코드 생성
4. 이어서 `POST /v1/data/employee` 호출 → `role: "admin"`, `bkend_user_id`, `company_id` 채워서 관리자 본인의 employee 레코드 생성
5. 로그인 완료 → 관리자 대시보드로 이동

> 2~4번은 화면상 "회원가입" 버튼 한 번으로 순차 실행되는 프론트엔드 로직이다(서버 함수 하나로 묶을 수도 있으나, 스켈레톤에선 프론트에서 순서대로 호출해도 충분히 단순하다).

### 2-3. 직원 초대·계정 생성 흐름 (스켈레톤 간소화 버전)

> ⚠️ **범위 조정 안내**: bkend.ai에는 "조직/프로젝트에 사람을 초대하는" 기능이 내장돼 있지만, 이는 **bkend.ai 콘솔에 접근할 팀원을 초대하는 기능**이라 우리 앱의 "회사가 자기 직원을 등록"하는 것과는 다른 개념이다. 따라서 스켈레톤에서는 이메일 초대 링크 없이 **관리자가 직접 직원 계정을 만들어주는 방식**으로 단순화한다. (실제 이메일 초대 흐름은 2차 단계에서 bkend.ai의 커스텀 이메일 발송 또는 자체 로직으로 추가 검토)

1. 관리자가 "직원 등록" 화면에서 이름·이메일·임시비밀번호 입력
2. `POST /v1/auth/email/signup` 호출(직원 이메일로) → Auth User 생성
3. `POST /v1/data/employee` 호출 → `role: "employee"`, `company_id`(관리자와 동일 회사), `bkend_user_id` 채워서 레코드 생성
4. 관리자가 직원에게 이메일/임시비밀번호를 (수동으로, 예: 메신저·메일로) 전달
5. 직원이 로그인 화면에서 해당 이메일/비밀번호로 로그인

### 2-4. 로그인 및 role 분기

1. `POST /v1/auth/email/signin` → 토큰 발급
2. 토큰으로 `GET /v1/data/employee?filter[bkend_user_id]=...` 호출해 본인의 employee 레코드(및 role) 조회
3. `role === "admin"` → 관리자 대시보드 / `role === "employee"` → 직원 메인 화면

### 2-5. 회사별 데이터 격리 (권한)

- **admin**: 자기 회사(`company_id` 일치) 범위의 employee·worksite·attendance_record 전체 CRUD
- **employee**: 본인이 생성한 attendance_record만 생성 가능, 조회는 본인 것만(RLS `self` 그룹 활용)
- bkend.ai RBAC 4개 그룹(admin/user/self/guest) 중, 스켈레톤에서는 **user(로그인한 모든 사람)** + **self(본인 데이터)** 조합으로 구현하고, "회사 admin"이라는 개념은 RLS의 `rowFilters`(company_id 일치)로 별도 구현한다. (bkend.ai의 `admin` 그룹은 "우리 회사 관리자"가 아니라 "테이블 전체 권한"을 뜻하므로 혼동 주의 — 실제로는 `user` 그룹 + 애플리케이션 로직에서 `employee.role` 값을 확인하는 방식을 쓴다)

---

## 3. GPS 지오펜스 판정 위치

### 3-1. 원칙: 클라이언트는 "측정"만, 서버는 "판정"만

- **직원 브라우저(클라이언트)**: `navigator.geolocation`으로 현재 위치(위도·경도·accuracy)를 1회 측정해서 서버로 전송한다. **판정(합격/불합격)은 클라이언트가 하지 않는다.** (gps-spec.md 원칙과 동일 — 좌표를 그대로 믿지 않음)
- **서버(거리 계산·반경 판정)**: bkend.ai는 "커스텀 서버 함수(서버리스 함수)"를 직접 지원하지 않는 순수 BaaS(Database+Auth+Storage)에 가깝다. 따라서 스켈레톤에서는 아래 **B안**을 채택한다.

### 3-2. bkend.ai에서 서버 로직을 두는 방법 — 2가지 선택지

| 선택지 | 방식 | 장점 | 단점 |
|---|---|---|---|
| **A안: bkend.ai 자체 서버 함수** | bkend.ai가 커스텀 백엔드 로직(함수) 실행을 지원하는 경우 그 안에서 거리 계산 | 완전한 BaaS 단일화 | ⚠️ bkend.ai가 임의 서버 함수 실행을 지원하는지 **MCP 문서에서 확인되지 않음** — 구현 착수 시 `search_docs`로 재확인 필요 |
| **B안(권장): 아주 얇은 중계 서버 1개 추가** | Next.js의 API Route(서버 사이드) 1개를 만들어, 여기서만 거리 계산 후 bkend.ai에 최종 기록을 저장 | 확실히 동작, 거리 계산 로직을 안전하게 서버에 숨김 | 순수 BaaS보다 아주 약간의 서버 코드가 필요(하지만 Next.js 프로젝트 안에 있어 별도 서버 운영 불필요) |

**➡️ 권장: B안.** Next.js API Route(`/api/attendance/gps`)에서:
1. 직원의 위치(lat, lng, accuracy)와 로그인 토큰을 받는다
2. bkend.ai에서 그 직원 회사의 `worksite` 목록을 조회한다(`GET /v1/data/worksite?filter[company_id]=...`)
3. Haversine 공식(위경도 간 거리 계산 공식)으로 각 사업장과의 거리를 계산한다
4. 사업장 중 하나라도 `거리 ≤ radius_m`이면 통과(`gps_ok: true`)
5. 통과 여부와 함께 `POST /v1/data/attendance_record`로 최종 기록을 bkend.ai에 저장한다

> 이렇게 하면 "판정 로직(거리 계산)"만 우리 쪽 얇은 서버 코드에 있고, 나머지 데이터 저장·인증은 전부 bkend.ai가 담당한다. Enterprise 수준의 인프라 구축이 아니라, Next.js가 기본 제공하는 API Route 파일 하나 추가하는 수준이다.

### 3-3. 위조방지(nonce) — 스켈레톤은 최소로

- API.md의 nonce(1회용 난수) 발급은 **스켈레톤 범위에서는 생략**한다. (요청 범위 밖 기능 추가 방지 원칙)
- 대신 최소한의 안전장치로: 서버(Next.js API Route)가 로그인 토큰을 검증하고, `occurred_at`은 클라이언트가 보낸 값이 아니라 **서버 도착 시각**을 사용한다(시각 조작 방지). nonce·기기바인딩 등 정교한 위조방지는 2차(얼굴인증 단계)에서 API.md 설계대로 추가한다.

---

## 4. 프런트엔드 방식 (개요만)

- **웹 1개로 관리자 PC + 직원 모바일 웹 모두 대응** (반응형). 별도 앱을 만들지 않는다(ARCHITECTURE.md 결정과 동일).
- **프레임워크**: Next.js 14+ (App Router) + TypeScript + Tailwind CSS — bkit `dynamic` 스킬의 기본 스택을 그대로 따른다.
- **디자인**: `docs/03_design/design-tokens.md`의 색상(Primary `#2563EB` 등)·간격·버튼 규칙을 Tailwind CSS 변수로 옮겨 스켈레톤 화면에도 최소 적용한다(스켈레톤이라 화려하게 꾸미지 않되, 색상 기준은 처음부터 맞춰 나중에 재작업을 줄인다).
- **상세 UI(정확한 배치·컴포넌트)는 이 문서 범위 밖**이다. 스켈레톤 화면은 기능이 되는지 확인하는 수준의 최소 레이아웃으로 만든다.

---

## 5. 화면 ↔ 기능 매핑 (스켈레톤 최소 화면)

| 화면 | screen-inventory 대응 | 핵심 기능 | 호출 API |
|---|---|---|---|
| 회사 회원가입 | #2 회사 회원가입 | 회사+관리자 계정 생성 | `POST /v1/auth/email/signup`, `POST /v1/data/company`, `POST /v1/data/employee` |
| 로그인 | #3 로그인 | 로그인 + role 분기 | `POST /v1/auth/email/signin`, `GET /v1/data/employee` |
| 직원 목록 (관리자) | #6 직원 목록/관리 | 직원 목록 조회 | `GET /v1/data/employee?filter[company_id]=...` |
| 직원 등록 (관리자) | #7 직원 초대 (간소화) | 직원 계정 생성 | `POST /v1/auth/email/signup`, `POST /v1/data/employee` |
| 메인/출퇴근 (직원) | #20 메인/출퇴근 화면 | 출근/퇴근 버튼 | (버튼 클릭 시 GPS 확인 화면으로) |
| GPS 확인 (직원) | #22 GPS 확인(출퇴근) | 위치 측정 → 판정 → 기록 | `POST /api/attendance/gps` (Next.js 중계) → 내부적으로 `POST /v1/data/attendance_record` |
| 오늘 근태 대시보드 (관리자) | #5 관리자 대시보드 (최소버전) | 오늘 출퇴근 현황 목록 | `GET /v1/data/attendance_record?filter[company_id]=...&filter[occurred_at]=오늘` |

> 사업장(worksite) 등록 화면은 스켈레톤에서는 별도 화면 없이 **관리자 대시보드 안 간단한 폼 1개**로 처리한다(온보딩 전체 화면은 2차에서 정식 구현).

---

## 6. 🔧 시작하려면 필요한 것 (사장님 준비 체크리스트)

| # | 항목 | 설명 | 완료 |
|---|---|---|---|
| 1 | bkend.ai 계정 | https://console.bkend.ai 에서 회원가입 | ☐ |
| 2 | bkend.ai Organization 생성 | 콘솔에서 팀/청구 단위 생성 | ☐ |
| 3 | bkend.ai Project 생성 | "근태관리" 프로젝트 생성 (dev 환경 자동 생성됨) | ☐ |
| 4 | MCP 연결 (Claude Code) | 터미널에서 `claude mcp add bkend --transport http https://api.bkend.ai/mcp` 실행 → 브라우저에서 로그인 승인 | ☐ |
| 5 | (확인용) "내 bkend 프로젝트 보여줘"라고 말해서 연결 확인 | | ☐ |
| 6 | 테스트용 사업장 좌표 1개 | 실제 사무실 주소 또는 테스트 주소(위도·경도) 1곳 — GPS 출퇴근 테스트용 | ☐ |

> **비밀키 안내**: bkend.ai는 OAuth 방식이라 API 키를 직접 다룰 필요가 없다(브라우저 로그인만 하면 됨). 다만 향후 GaonFR 얼굴 API 연동 시 필요한 `ClientToken` 같은 비밀값은 **절대 소스 코드나 문서에 적지 않고, `.env.local` 파일에만 저장**한다(이 파일은 git에도 올리지 않는다). 이번 스켈레톤 단계에서는 얼굴인증을 다루지 않으므로 해당 비밀값은 아직 필요 없다.

---

## 7. 구현 순서 (작은 단위, 각 단계 끝에 눈으로 보이는 결과)

| 단계 | 작업 | 눈으로 확인 가능한 결과 |
|---|---|---|
| 1 | bkend.ai 프로젝트 준비 (위 체크리스트 1~5) | MCP로 "프로젝트 목록"이 보임 |
| 2 | 테이블 4개 생성 (`company`, `employee`, `worksite`, `attendance_record`) + RLS 설정 | bkend.ai 콘솔에서 테이블 스키마가 보임 |
| 3 | Next.js 프로젝트 생성 + bkend.ai 클라이언트 연결 | 로컬에서 빈 페이지가 뜸(연결 테스트) |
| 4 | 회사 회원가입 + 로그인 화면 구현 | 실제로 가입 → 로그인 → "환영합니다" 화면 진입 확인 |
| 5 | 관리자: 직원 등록 + 목록 화면 구현 | 관리자가 직원 1명을 등록하면 목록에 뜸 |
| 6 | 관리자: 사업장 좌표 등록(간단 폼) | 사업장 1곳이 저장됨 |
| 7 | 직원: 로그인 → 메인 화면 → GPS 출근 버튼 | 버튼 누르면 "출근 처리되었습니다" 또는 "반경 밖입니다" 메시지가 뜸 |
| 8 | 관리자: 오늘 근태 대시보드 | 방금 찍은 출근 기록이 목록에 나타남 |
| 9 | 전체 흐름 재확인 (회원가입→로그인→직원등록→GPS출근→대시보드) | 처음부터 끝까지 한 번에 시연 가능 |

> 각 단계 완료 시 4줄 보고(완료 작업/생성 파일/위험 요소/다음 단계)를 드린다.

---

## 8. 보안 반영 (review.md 기준, 스켈레톤부터 지킬 지점)

| review.md 항목 | 스켈레톤에서 지키는 방법 |
|---|---|
| 멀티테넌트 필터 강제 (E항목) | `employee`/`worksite`/`attendance_record` 전 테이블에 `company_id` 필드 + RLS `rowFilters` 설정. 프론트 코드가 필터를 빼먹어도 서버가 막음 |
| 비밀값 env 전용 | bkend.ai는 OAuth라 키 노출 자체가 적음. 향후 필요한 비밀값은 `.env.local`에만, git 미포함 확인 |
| HTTPS 전용 | bkend.ai Service API·Next.js 배포(Vercel) 모두 기본 HTTPS |
| 입력 검증 | GPS 좌표(숫자 범위), 이메일 형식, 필수값 등을 Next.js API Route와 폼에서 서버측 검증 추가 |
| IDOR 방지 (다른 회사 id 접근 차단) | 모든 조회 API 호출 시 로그인 토큰에서 얻은 `company_id`로만 필터링(URL의 id를 그대로 신뢰하지 않음) |
| GPS 원본좌표 미저장 원칙 (gps-spec 3-A 결정) | `attendance_record`에 lat/lng 원본 필드를 넣지 않고 `gps_ok`(판정결과)·`worksite_id`·`occurred_at`만 저장 |

---

## 완료 작업
ERD·API·ARCHITECTURE·gps-spec·screen-inventory·wireframes·security review·PROGRESS를 검토해 bkend.ai 기반 walking skeleton(회사가입→로그인→직원등록/목록→GPS출퇴근→대시보드) 구현 계획서를 작성했다. 데이터 모델 매핑(4개 테이블+RLS 멀티테넌트 격리), 인증/권한 흐름(Auth User와 employee 레코드 분리, 초대 기능 범위 조정 명시), GPS 판정 위치(Next.js API Route 중계 방식 B안 권장, nonce는 2차로 유예), 프런트엔드 개요, 화면↔API 매핑, 사장님 준비 체크리스트, 9단계 구현 순서, 보안 반영표까지 포함했다.

## 생성 파일
- C:\Users\주인님\Desktop\신사업 아이디어\근태관리\docs\05_backend\skeleton-plan.md

## 위험 요소
- **bkend.ai의 서버 함수(커스텀 로직) 지원 여부가 문서상 불명확**함 — GPS 거리 계산을 bkend.ai 내부에서 처리할 수 있는지 확인되지 않아, 이 계획은 "Next.js API Route로 얇게 중계"하는 B안을 권장안으로 제시했다. 구현 착수 시 MCP `search_docs`로 재확인 후 A안(자체 지원)이 가능하면 더 단순화할 수 있음.
- **직원 초대(이메일 링크) 기능은 이번 스켈레톤에서 간소화**(관리자가 직접 계정 생성)했다. 실제 이메일 초대 UX는 2차 단계에서 별도 검토 필요.
- **bkend.ai 실제 RLS 문법(rowFilters 등)은 최신 문서 기준 추정치**다. 구현 시작 시 실제 콘솔/MCP에서 정확한 설정 방법을 재확인해야 한다.

## 다음 단계 제안
- 사장님이 이 계획서(특히 §3 GPS 판정 방식 B안, §2-3 직원 등록 간소화 방식)를 승인하면, 위 §7 구현 순서 1단계(bkend.ai 프로젝트 준비)부터 착수한다.
- 승인 전 확인 요청: (1) B안(Next.js 중계 서버 1개)으로 GPS 판정 처리하는 것에 동의하시는지, (2) 이번 스켈레톤에서는 이메일 초대 없이 관리자가 직접 직원 계정을 만드는 간소화 방식으로 진행해도 되는지.
