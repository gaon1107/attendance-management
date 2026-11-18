# Plan: 운영 준비 4단계 — 서버 E 설치 (2026-11-18) — 상태: ✅ 완료(2026-11-19) — 결과는 맨 아래 "실행 결과"

> 6단계 전체표는 `project-status.md` 맨 위. 안내서 `deploy/server/README.md`, 체크리스트 `docs/09_test/배포전_체크리스트.md`(3·6·7·8번).
> 서버 E = gaon-main(115.68.195.240, Ubuntu 24.04, 15GB, TZ Asia/Seoul, SSH 열쇠 전용). LMS·홈페이지 등 운영 중 — **기존 파일·상자·설정은 건드리지 않는다**(새 파일만 추가).

## 조사 결과 (2026-11-18, 서버 읽기만)
- `attend.newgaon.com` 주소는 **아직 등록 안 됨**(가비아 DNS). lms.newgaon.com은 115.68.195.240.
- nginx 1.24: `conf.d/*.conf`(비어 있음) + `sites-enabled/*`(서비스별 파일) 구조. `server_tokens off`. 인증서 certbot 2.9 + 자동 갱신 타이머.
- 다른 서비스가 이미 **사무실 IP 허용 목록**(`allow 59.12.82.205` 등) 방식을 쓴다. 이 PC의 지금 인터넷 주소는 59.12.82.216.
- ⚠️ 사장님 인터넷 주소는 **유동 IP**라 자주 바뀐다(11-12 14.47.154.187 → 11-18 59.12.82.216). vending·gfkids는 바뀔 때마다 `allow`를 손으로 추가해 왔다 → 근태 운영자 화면은 **IP 제한을 쓰지 않는다**(결정 1 수정).
- 깃허브 받기는 서비스별 **읽기 전용 배포 열쇠 + 별명**(`github-lms`, `github-gaon`) 방식. 이 PC에는 `gh` 도구가 없어 열쇠 등록은 깃허브 웹 화면에서 한다.
- 외부 보관: `/root/gaon_daily_backup.sh`(매일 03:40)가 rclone으로 CLOUDV 오브젝트 스토리지에 30일 보관.

## 순서 (각 단계 명령을 보여드리고 실행 → 결과 확인 → 다음)
| # | 내용 | 누가 |
|---|---|---|
| 4-1 | 가비아에서 `attend` → 115.68.195.240 주소(A 레코드) 등록 | 사장님 |
| 4-2 | 서버에 근태 전용 읽기 전용 배포 열쇠 만들기(별명 `github-attendance`) → 공개키를 깃허브 저장소 Deploy keys에 등록 → `/opt/attendance` 받기 | 저 + 사장님(깃허브 웹에서 등록) |
| 4-3 | 데이터·백업 폴더(uid 10001, 700) · `/opt/attendance/.env`(ATT_DATA_DIR) · `webapp/.env.production`(600): 사진 암호화 키는 서버에서 새로 생성(사장님이 서버에서 보고 따로 보관), TRUST_PROXY=1, 외부 API 키, 얼굴 값 비움(5단계), 문자 끔 | 저 + 사장님(키 보관) |
| 4-4 | 첫 반영 `deploy.sh` — 서버에서 상자 빌드(5~10분). 그동안 LMS 메모리·응답 감시 | 저 |
| 4-5 | nginx **새 파일만 추가**: `sites-available/attend.newgaon.com`(HTTP→HTTPS, 필수 4줄, /login 캐시 금지, `/operator` 요청 수 제한 → 문 비밀번호) + `conf.d/attendance-ratelimit.conf`(서버 액션·운영자 요청 수 제한 구역) + `/etc/nginx/attendance-operator.htpasswd`(문 비밀번호 2명분, root:www-data 640) → `nginx -t` 통과 후 무중단 반영 → certbot 인증서 | 저 |
| 4-6 | 운영자 계정 2개(사장님 + 예비) — 비밀번호는 사장님이 직접 입력. 4-5에서 서버가 만든 **문 비밀번호**를 이때 한 번 보여드림 → 사장님이 따로 보관 | 사장님 |
| 4-7 | 매일 백업 cron 등록 + 외부 보관소: 기존 `gaon_daily_backup.sh`에 근태 백업 폴더 업로드 한 덩이 추가(기존 파일 수정 — 백업 후) | 저 |
| 4-8 | 최종 점검: 바깥에서 https 접속, 시험 회사 가입→초대→출퇴근→지움, 운영자 화면 문 비밀번호(없으면 401 · 있으면 로그인→무료기간 저장까지 정상 — 화면 안쪽 요청에도 문 비밀번호가 실려 가는지 확인), 백업 1회·외부 업로드 확인, 보안 헤더·HSTS | 저 |

되돌리기: `docker compose down`(근태만) → nginx 새 파일 2개(사이트 파일·링크, 문 비밀번호 파일) 삭제·reload → 공용 백업은 `.bak-20261118-attendance`로 되돌림 → 다른 서비스는 원래 그대로.

## 사장님 결정 (추천안)
1. **운영자 화면 보호** — ~~사무실 IP 2개만 허용~~ → **(11-18 수정: 유동 IP라서) 문 비밀번호.** `/operator`에 들어오면 서버 입구(nginx)가 먼저 비밀번호를 묻고, 맞아야 앱의 운영자 로그인이 나온다(비밀번호 2겹). 사무실·집·고객사 현장 어디서든 접속 가능, 비용 0, 코드 변경 0.
   - 기술 메모: ① `limit_req`(IP당 + 전체 상한)가 `auth_basic`보다 **먼저** 돈다(nginx 처리 순서 PREACCESS→ACCESS) → 쏟아붓기는 비밀번호 계산 전에 잘린다. ② 해시는 `openssl passwd -6`(SHA-512) — **bcrypt 금지**(nginx 작업자를 수십 ms 멈춰 같은 서버의 LMS까지 느려진다). ③ 문 비밀번호는 서버에서 무작위 24자, 2명분(한 명만 끌 수 있게). 잊으면 `ssh gaon-main`으로 다시 만든다. ④ 경로 제한은 "화면을 숨기는 것"이다 — 서버 액션을 다른 주소로 쏘는 우회 쏟아붓기는 4-5의 서버 액션 요청 수 제한 + 코드 상한(`lib/operator-policy.ts`)이 막는다(IP 제한안도 똑같았다). ⑤ 4단계 마칠 때 체크리스트 6번 문구(IP → 문 비밀번호) 갱신.
2. **외부 서비스 키(공휴일·사업자등록 확인·주소→좌표)**: 개발용과 같은 키 사용(같은 회사 계정 발급분).
3. **외부 보관소 백업**: 기존 서버 백업 스크립트에 근태 백업을 한 덩이 추가(30일 보관 그대로).

## 하지 않는 것
얼굴인증 연결(5단계) / 문자 켜기(M7 먼저) / 자동 배포 / 페어파트너 계정 개설(6단계) / LMS·다른 서비스 설정 변경(외부 보관 스크립트 한 덩이 추가 제외)

---

## 실행 결과 (2026-11-18 밤 ~ 11-19) — 계획과 달라진 점은 ★

| # | 결과 |
|---|---|
| 4-1 | 가비아 A `attend` → 115.68.195.240(TTL 600). 사장님 로그인 후 크롬으로 등록, 기존 36줄 그대로(37줄). 가비아·구글 DNS 즉시 조회 확인 |
| 4-2 | ★열쇠 별명(ssh config) 대신 **저장소 안 `core.sshCommand`** 로 근태 전용 열쇠 `/root/.ssh/attendance_deploy_key` 지정 — 기존 `/root/.ssh/config` 무변경. 깃허브 Deploy key "gaon-main 서버E (읽기 전용)" Read-only(지문 `vjDDTY5…` 서버와 일치). `/opt/attendance` = main |
| 4-3 | `/data/attendance`(10001, 700)·`/data/attendance-backups`(root, 700). `/opt/attendance/.env`·`webapp/.env.production` 600. 사진 키는 서버 생성(화면 출력 없이), 외부 키 3개는 이 PC `.env`에서 값 출력 없이 이전. 얼굴 4칸 비움 |
| 4-4 | `deploy.sh` 첫 반영 약 1분 30초, healthy, 마이그레이션 83개, 메모리 67MB, 127.0.0.1:3300만. LMS 응답 전후 동일 |
| 4-5 | ★`conf.d` 파일은 만들지 않음 — 요청 수 제한 구역도 사이트 파일 하나(`deploy/server/nginx/attend.newgaon.com.conf` = 서버 `sites-available/attend.newgaon.com`)에 넣었다(vending과 같은 방식, 되돌리기 쉬움). 인증서 2027-02-16 만료·`renew_hook = systemctl reload nginx`. 문 비밀번호 `/etc/nginx/attendance-operator.htpasswd`(owner·spare, SHA-512, root:www-data 640) |
| 4-6 | 운영자 `psh01@newgaon.co.kr`(대표) 생성·실로그인 확인(2겹 정상). 접속 기록 IP = 59.12.82.216 → **TRUST_PROXY·X-Forwarded-For 정상**. 예비 계정은 사장님 몫. 도우미 `/root/att-create-operator.sh`(비밀번호 표준입력 전달)는 쓰고 삭제 |
| 4-7 | `/etc/cron.d/attendance-backup` 03:30. ★공용 `gaon_daily_backup.sh`는 "폴더 업로드"가 아니라 ① 프로젝트 묶음에서 `data/attendance`·`data/attendance-backups` **제외**(도는 중 SQLite 원본·14일치 중복 방지) ② 03:30 근태 백업의 **최신 1쌍만** `obj:gaon-main-backup/attendance-backups/`에 업로드 ③ 24시간 안 근태 백업이 없으면 FAIL. 원본 `/root/gaon_daily_backup.sh.bak-20261118-attendance`. 1회 실행 → 업로드·크기 대조 OK, 묶음 속 근태 0건 |
| 4-8 | 바깥에서: http→https 301, `/login` `Cache-Control: private, no-store`(한 줄)+앱 보안 헤더·HSTS, 인증서 검증 0. 서버에서: 문 비밀번호 없음/틀림 401·맞음 200(임시 계정으로 시험 후 삭제), 6MB 일반 413·문서 업로드 통과, 쓰기 140건 → 123 통과·17건 429, 다른 9개 사이트 응답 전후 동일(설정 반영 2회 모두). ★시험 회사 가입→출퇴근은 운영 주소에서 비밀번호 입력이 필요해 6단계(페어파트너 개설·실폰 시험)에서 사장님과 함께 한다 |

**code-reviewer 검수**: 치명 0 · 중간 4 · 경미 10.
- 반영: M1(`/api/agent/` 접두사 → 실제 4개 정규식, 우회 시 429 확인) · L1·L2(도우미 비밀번호 표준입력·띄어쓰기 보존·안내 주소) · L5(X-Forwarded-Host 덮어쓰기) · L6(업로드 전용 분당 30) · L7(화면 보기 IP당 초당 50·순간 500, 정적 제외 — 1,500건 몰아 보내기에서 528건 차단 확인)
- 해당 없음: M2(인증서 갱신 뒤 reload — 발급 때 `renew_hook` 설정 확인) · 범위 밖 7(Docker 29.9.2 ≥ 28)
- 사장님 확인: M4(사진 키 따로 보관 — 사장님이 값 확인함)
- 보고만(다음 할 일): M3 바깥 감시(Uptime Kuma에 `https://attend.newgaon.com/login` + 백업 push — Kuma 로그인 필요) · L8 배포 때 상자 로그 사라짐 · L10 외부 보관소 근태 DB 암호화(rclone crypt) · 앱 코드: 전체 상한이 IP별 검사보다 먼저 셈(`auth.ts:87-101`), PC 연결코드 10회 틀리면 사무실 전체 10분 잠김(`agent-auth.ts`) · 배포는 근무시간 밖에(서버 액션 번호 바뀜) · 개인정보처리방침에 외부 보관(위탁)·사진 백업 최대 30일 추가 보관 반영 · 도입 첫날 전 직원 동시 등록은 쓰기 상한(약 420건/5분)에 걸릴 수 있음 → 나눠 등록 안내

**비밀값 보관(사장님)**: 문 비밀번호 owner·spare, `CLOCK_PHOTO_KEY` — 사장님이 서버에서 확인. 채팅에 붙여 넣은 값은 교체하지 않기로 사장님 결정(2026-11-19).
