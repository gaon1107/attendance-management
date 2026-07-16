# Research: 5단계 — 차단 IP·자동차단 (+ 4단계 잔여: 동의 개시 기록) — 2026-07-16

## A. 4단계 잔여 — 생체정보 "동의 개시" 기록 (작음)

- `actions/authmethod.ts:47 agreeBiometric` — 호출처 **1곳**(`app/consent/ConsentForm.tsx:17` 폼). 공통 모듈 아님.
- 현재: `User.faceConsentAt`에 **시각만** 저장 → **재동의하면 덮여서 과거 이력 소실**. 파기는 남는데 수집 개시는 안 남음.
- 조치: `logAdminAction(me, "config", "biometric_consent")` 한 줄 + 라벨 추가.
  - ⚠️ `agreeBiometric`도 **`redirect()`로 끝남** → 기록을 redirect 앞에.
  - kind 선택: `purge`는 파기라 부적절, `data_view`도 아님 → **`config`** 사용(이미 화면 `ACCESS_KINDS`에 있음 = 침묵누락 없음).
- 위험: 거의 없음(1곳, add-only, 성공 지점).

---

## B. 5단계 — 차단 IP 관리 + 자동차단

### B-1. 🔴 Next 16 확인 결과 — **미들웨어가 `proxy`로 이름이 바뀜**

`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` 확인:
- **"Starting with Next.js 16, Middleware is now called Proxy"** — 파일명은 프로젝트 루트 `proxy.ts`, 함수는 `export function proxy(request)`.
- **런타임: Node.js 기본**(v16부터). `runtime` 설정은 **에러**가 남. → 예전과 달리 **proxy에서 Prisma 사용 가능**.
- 그러나 문서가 명시적으로 경고:
  > *"Proxy is **not** intended for slow data fetching... it should **not** be used as a full session management or authorization solution."*
- **결론**: 전역 proxy에서 매 요청마다 DB로 차단여부를 조회하는 것은 **문서 권고 위반 + 모든 요청에 DB 왕복 추가**.
  → **원래 계획대로 진입점(로그인·출퇴근)에서만** 검사한다. proxy는 쓰지 않는다.

### B-2. 🔴 멀티테넌트 함정 — "로그인 시점엔 아직 회사를 모른다"

`actions/auth.ts:63~73` — 로그인은 **이메일로 사용자를 찾은 뒤에야** `companyId`를 안다.
차단 규칙은 회사별(`BlockedIp.companyId`)인데, **IP만 보고는 어느 회사 규칙을 적용할지 알 수 없다.**

- 조치: **사용자를 찾은 뒤**(companyId 확보) 차단 검사 → 차단이면 거부 + `kind:"blocked"` 기록.
- 한계(정직하게 기록): **존재하지 않는 이메일**로 두드리는 공격은 회사를 알 수 없어 차단 대상이 안 됨.
  → 그건 기존 **5회 실패 잠금**(auth.ts:55)이 담당. 이번 범위에서 해결하지 않음.

### B-3. 🔴 자기잠금(관리자가 스스로 잠김) — 가장 큰 위험

- 방어 3중:
  1. **회사 허용 IP(officeIps)는 절대 차단 안 함** — `ipMatches(ip, company.officeIps)`면 무조건 통과.
  2. **차단 규칙을 "추가하는 관리자의 현재 IP"와 겹치면 저장 거부** — 스스로 잠그는 규칙을 애초에 못 만들게.
  3. **차단은 로그인·출퇴근 진입점에만 적용** — 차단 해제 화면(`/security/blocked`)은 차단 대상이 아니라, 이미 로그인한 관리자는 못 잠김.
- ⚠️ 그래도 남는 위험: 관리자가 **로그아웃한 상태**에서 자기 IP가 차단되면 못 들어옴 → 방어 1·2로 막고, 최후에는 DB 직접 수정(문서화).

### B-4. 영향 범위 (수정 대상을 쓰는 모든 곳)

| 대상 | 호출처 | 이번에 |
|---|---|---|
| `lib/ip.ts` `ipMatches` | 5곳(출퇴근 판정·설정화면·접속로그 화면·엑셀·정의부) | **무수정**(읽기만 재사용) |
| `actions/auth.ts` `login` | 1곳(`app/login/LoginForm.tsx`) | 사용자 조회 **뒤** 차단검사 add-only |
| `actions/attendance.ts` `clockIn/clockOut` | **4곳**(일반출근·일반퇴근·얼굴화면퇴근·얼굴출퇴근) | 🚧 본체 무수정 원칙 — **차단검사를 넣을지 재검토**(아래) |
| `lib/access-log.ts` | 공통 | 무수정(`kind:"blocked"` 이미 정의됨) |

**출퇴근 차단 재검토**: 이미 로그인한 직원이 출퇴근을 누르는 시점에 차단하면, **차단당한 직원은 출근이 안 되는데 이유를 모른다**(화면에 "차단됨"을 알리면 공격자에게 정보 제공). 게다가 clockIn/clockOut 본체는 무수정 원칙. → **이번엔 로그인 진입점만** 차단하고, 출퇴근 차단은 범위에서 제외(로그인이 막히면 어차피 새 세션을 못 만든다).

### B-5. DB — `BlockedIp` 모델 신설 필요(스키마 변경 O)

- 필드(안): `id`·`companyId`·`pattern`(IP 또는 대역)·`reason`·`createdBy`(관리자 이름 스냅샷)·`createdAt`·`expiresAt?`(임시차단용)·`source`("manual"|"auto")
- 인덱스: `@@index([companyId])`
- ⚠️ **마이그레이션 필요** → 사장님 3000 서버가 켜져 있으면 EPERM. **끄고 진행**(4단계 땐 꺼져 있어 문제 없었음).

### B-6. 자동차단 — 범위 축소 제안

원 계획 "연속 실패 시 자동차단"은 **이미 있는 5회 실패 잠금(계정 단위)** 과 겹친다.
IP 단위 자동차단은 **오탐 시 회사 전체가 잠기는** 위험(같은 공인 IP를 쓰는 사무실 전원)이 커서,
**이번엔 수동 차단 + 자동차단 "후보 표시"(N회 실패한 IP를 화면에 보여주고 관리자가 판단해 차단)** 를 제안.
→ 진짜 자동차단은 운영 데이터로 오탐률을 본 뒤 6단계 이후 결정.

## 결론

- A(동의 개시)는 **5줄, 위험 거의 0** → 먼저 처리.
- B는 **스키마 변경 1개 + 로그인 진입점 add-only + 화면 1개**. proxy는 안 씀(문서 권고).
- **자동차단은 축소 제안**(수동 차단 + 후보 표시) — 사장님 확인 필요.
