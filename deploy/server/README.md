# 근태관리 운영 서버(서버 E) 안내서

> 2026-11-18 운영 준비 2단계에서 만들었다. **실제 서버 설치는 4단계**에서 이 안내서대로 한다.
> 서버 E = gaon-main(115.68.195.240, Ubuntu 24.04, 시간대 Asia/Seoul). 사장님 PC PowerShell에서 `ssh gaon-main`으로 접속한다(열쇠 전용).

## 구성 한눈에

| 항목 | 위치·값 |
|---|---|
| 코드 | `/opt/attendance` (깃허브 `gaon1107/attendance-management` main) |
| 데이터(DB·출퇴근 사진·문서) | `/data/attendance` → 상자 안 `/data` |
| 백업 | `/data/attendance-backups` (매일 03:30 + 반영할 때마다, 14일 보관) |
| 운영 설정값 | `/opt/attendance/webapp/.env.production` (깃 제외, 목록표: `webapp/.env.production.example`) |
| 묶음 설정값 | `/opt/attendance/.env` (깃 제외) — `ATT_DATA_DIR=/data/attendance` 한 줄 |
| 상자 이름·연결 | `attendance-app`, 서버 안 `127.0.0.1:3300` (바깥은 nginx `attend.newgaon.com` HTTPS로만) |
| 상자 실행 번호 | uid/gid **10001**(근태 전용). 서버의 uid 1000은 사람 계정(`user`)이라 쓰지 않는다 |

LMS(`/opt/newgaon-LMS`, `lms-*` 상자)·홈페이지 등 **다른 서비스의 파일·상자·설정은 건드리지 않는다.**

## 처음 설치 (4단계 — 한 번만) — ✅ 2026-11-18 서버 E 설치 완료(기록: `plan-운영준비-4단계.md` "실행 결과")

```bash
# 1) 데이터·백업 폴더 (상자는 uid 10001로 돈다. 다른 계정은 읽지 못하게 700)
mkdir -p /data/attendance/db /data/attendance/storage/{clock-photos,company-docs,request-attachments} /data/attendance-backups
chown -R 10001:10001 /data/attendance && chmod 700 /data/attendance /data/attendance-backups

# 2) 코드 받기 — 비공개 저장소라 "읽기 전용 배포 열쇠"를 서버에 만들어 깃허브 Deploy keys(Read-only)에 등록한 뒤 clone
#    열쇠는 저장소 설정(core.sshCommand)으로만 지정한다 — 다른 서비스가 쓰는 /root/.ssh/config 는 건드리지 않는다
ssh-keygen -q -t ed25519 -N '' -C 'attendance-deploy@gaon-main' -f /root/.ssh/attendance_deploy_key
git clone -c core.sshCommand='ssh -i /root/.ssh/attendance_deploy_key -o IdentitiesOnly=yes' git@github.com:gaon1107/attendance-management.git /opt/attendance

# 3) 묶음 설정값 — 데이터 폴더를 지정한다(빠지면 상자가 아예 실행을 거부한다)
echo 'ATT_DATA_DIR=/data/attendance' > /opt/attendance/.env

# 4) 운영 설정값 — 목록표를 복사해 값을 채운다. CLOCK_PHOTO_KEY는 여기서 새로 만들고 즉시 따로 보관
cp /opt/attendance/webapp/.env.production.example /opt/attendance/webapp/.env.production
chmod 600 /opt/attendance/webapp/.env.production
openssl rand -hex 32     # ← 이 값을 CLOCK_PHOTO_KEY 에 넣는다(잃으면 사진 복구 불가)

# 5) 첫 반영
bash /opt/attendance/deploy/server/deploy.sh

# 6) 매일 백업 등록
echo '30 3 * * * root bash /opt/attendance/deploy/server/backup-attendance.sh >> /var/log/attendance-backup.log 2>&1' > /etc/cron.d/attendance-backup
```

## nginx·HTTPS (2026-11-18 설치)

| 항목 | 위치·값 |
|---|---|
| 설정 파일(원본) | 저장소 `deploy/server/nginx/attend.newgaon.com.conf` → 서버 `/etc/nginx/sites-available/attend.newgaon.com`(+ `sites-enabled` 링크) |
| 인증서 | certbot webroot(`/var/www/certbot`), 2027-02-16 만료, 자동 갱신 뒤 `systemctl reload nginx`(renew_hook) |
| 근태 전용 기록 | `/var/log/nginx/attend.access.log`, `/var/log/nginx/attend.error.log`(요청 수 제한에 걸린 줄 = `limiting requests`) |
| 요청 수 제한 | 쓰기(POST 등) IP당 분당 60·순간 120 / PC 프로그램 4개 주소 분당 600 / 업로드 2곳 분당 30 / 화면 보기 IP당 초당 50·순간 500 / 운영자 화면 IP당 분당 300·전체 초당 30 |
| 운영자 화면 문 비밀번호 | `/etc/nginx/attendance-operator.htpasswd`(root:www-data 640, SHA-512) — 아이디 `owner`(사장님)·`spare`(예비) |

**설정을 고칠 때**: 저장소 파일을 고쳐 커밋 → 서버로 복사 → `nginx -t` 통과할 때만 `systemctl reload nginx`. 반영 전후로 다른 사이트(lms·gfkids·vending 등) 응답이 같은지 본다.
⚠️ `app/api/agent/` 아래에 새 주소를 만들면 설정 파일의 PC 프로그램 정규식 목록에도 넣는다(빠지면 분당 60 제한에 걸린다).

**문 비밀번호 관리** (해시는 반드시 `openssl passwd -6` — bcrypt는 nginx를 멈춰 LMS까지 느려진다)
```bash
H=/etc/nginx/attendance-operator.htpasswd
cut -d: -f1 $H                                   # 아이디 목록
P=$(python3 -c "import secrets;a='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';print(''.join(secrets.choice(a) for _ in range(20)))")
sed -i '/^owner:/d' $H && printf 'owner:%s\n' "$(printf '%s' "$P" | openssl passwd -6 -stdin)" >> $H   # owner 값 새로 만들기
echo "$P"; unset P                               # ← 새 값을 사장님이 바로 보관(채팅·문서에 적지 않는다)
sed -i '/^spare:/d' $H                           # 한 사람만 끄기(지우기) — nginx 다시 읽기 필요 없음
```

## 운영자 계정 (앱 안 2번째 문)

계정 도구는 상자 안에 있다. 목록·잠금 풀기·끄기는 그대로 쓴다.
```bash
docker exec attendance-app node scripts/create-operator.mjs --list
docker exec attendance-app node scripts/create-operator.mjs --unlock "이메일"
```
🔴 **비밀번호가 들어가는 명령(새 계정·`--reset`)은 명령줄에 비밀번호를 적지 않는다**(서버 프로세스 목록·명령 기록에 남는다). 표준입력으로 넘긴다:
```bash
RUNNER='const a=require("fs").readFileSync(0,"utf8").split(String.fromCharCode(0)); a.pop(); process.argv=[process.argv[0],"/app/scripts/create-operator.mjs",...a]; import("/app/scripts/create-operator.mjs");'
IFS= read -rs -p "Password: " P; echo
printf '%s\0%s\0%s\0' "--reset" "이메일" "$P" | docker exec -i -e APP_BASE_URL=https://attend.newgaon.com attendance-app node -e "$RUNNER"; unset P
# 새 계정이면: printf '%s\0%s\0%s\0' "이메일" "$P" "표시 이름" | ...(같은 뒤 명령)
```

## 외부 보관소(백업 서버 밖 보관)

- 03:30 근태 백업(`/etc/cron.d/attendance-backup`) → 03:40 서버 공용 백업(`/root/gaon_daily_backup.sh`)이 **근태 최신 1쌍만** CLOUDV 저장소 `gaon-main-backup/attendance-backups/`에 올린다(30일 보관, 크기 대조).
- 공용 백업의 `/data` 묶음에서는 `data/attendance`·`data/attendance-backups`를 뺐다(도는 중 DB 원본·14일치 중복 방지). 24시간 안 근태 백업이 없으면 공용 백업 기록에 오류로 남는다.
- 기록: `/data/backup/backup.log`(공용) · `/var/log/attendance-backup.log`(근태). 공용 스크립트 수정 전 원본: `/root/gaon_daily_backup.sh.bak-20261118-attendance`.
- ⚠️ `CLOCK_PHOTO_KEY`·`.env.production`은 **어떤 백업에도 없다** — 사장님이 따로 보관한 값으로 되살린다.

## PC-OFF 내려받기 파일 (2026-11-20)

- 주소 `https://attend.newgaon.com/download/pc-off` → nginx가 서버 파일 `/var/www/attend-downloads/pc-off.zip`을 그대로 내려준다(앱 무관, 공개).
  관리자 [PC관리]·직원 [계정 → 내 PC 연결]이 이 주소를 안내한다(`webapp/lib/pcoff-download.ts`).
- 파일은 **깃에 넣지 않는다**(60MB대). 이 PC에서 만들어 서버로 올린다.

**새 파일로 바꾸는 순서** (주소는 그대로)
1. 이 PC에서 배포판을 만든다 — **Release**만(Release에는 테스트 모드가 없다. Debug 실행 파일을 올리면 직원이 `--test-mode`로 잠금을 우회한다):
   ```powershell
   cd pc-agent; dotnet publish src\NewgaonPcOff\NewgaonPcOff.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true
   ```
   → `bin-시험판\public\PC-OFF\NewgaonPcOff.exe`로 복사 → `bin-시험판\public`에서 `tar.exe -a -c -f ..\pc-off.zip PC-OFF` (윈도우 기본 tar — 표준 `/` 경로로 묶인다).
2. **임시 이름으로** 올린다: `scp pc-off.zip gaon-main:/var/www/attend-downloads/pc-off.zip.new`
   (바로 덮어쓰면 올리는 동안 받은 직원이 깨진 파일을 받는다)
3. 서버에서 **내용 확인**(서버에 unzip이 없다 — python 사용): `python3 -m zipfile -l /var/www/attend-downloads/pc-off.zip.new` → `PC-OFF/`(폴더 줄)과 `PC-OFF/NewgaonPcOff.exe` **두 줄만** 있어야 한다(.bat·다른 파일이 있으면 멈춤).
   올린 파일과 이 PC 파일의 `sha256sum`이 같은지도 본다.
4. 한순간에 교체: `mv -f pc-off.zip.new pc-off.zip && chmod 644 pc-off.zip`
5. 확인: `curl -sI https://attend.newgaon.com/download/pc-off` → 200·`Content-Disposition: attachment`·크기.
- **처음 열 때 순서**: 파일 올리기 → nginx 반영(아래 "nginx·HTTPS"의 고칠 때 절차) → 마지막에 웹앱 배포.
  (웹앱이 먼저 나가면 그 사이 직원 링크가 앱의 404로 간다)
- 제한: 전용 구역 `att_dl`(IP당 분당 120·순간 200) · 동시 연결 IP당 10·사이트 20 · 연결당 2MB/s(전체 최대 ≈320Mbps — 회선 속도 미확인이라 보수적으로). 걸리면 한글 안내(429)가 나온다.

## 새 버전 반영

**2026-11-21부터 자동이다: 깃허브 `main`에 푸시하면 곧바로 운영에 반영된다.** (학원관리와 같은 방식)
- 흐름: 푸시 → 깃허브 Actions(`.github/workflows/deploy.yml`) → 배포 전용 열쇠로 서버 E 접속 → 서버가 `deploy.sh` 실행 → 바깥에서 로그인 화면 200 확인.
- 결과 보기: 깃허브 저장소 → **Actions** 탭(초록 ✔ = 성공, 빨간 ✖ = 실패. 눌러 보면 deploy.sh 기록이 그대로 나온다).
  서버에도 같은 기록이 남는다: `tail -50 /var/log/attendance-deploy.log`.
- 푸시 없이 한 번 더: Actions → "Deploy attendance to gaon-main" → **Run workflow**.
- 접속이 끊기거나 Actions에서 Cancel 해도 **서버의 배포는 끝까지 간다**(자동 배포 때는 서버가 접속과 떼어 돌린다). 결과는 위 서버 기록으로 본다.
- ⚠️ 푸시 = 운영 반영이므로 **푸시는 근무시간 밖에** 한다(열린 화면의 버튼이 잠깐 오류 난다).
- ⚠️ **새벽 3~4시에는 푸시하지 않는다** — 03:30 정기 백업과 반영 전 백업이 겹치면 둘 중 하나가 "다른 백업 실행 중"으로 실패한다.

수동 반영(자동이 고장 났을 때도 그대로 된다):
```bash
bash /opt/attendance/deploy/server/deploy.sh
```
- 새 이미지를 **먼저** 만든다. 빌드가 실패하면 교체 전에 멈추므로 기존 상자가 그대로 돈다.
- 앱 내용이 바뀌었으면 **반영 전에 백업을 뜨고**, 지금 돌던 이미지를 `attendance-app:previous`로 남긴 뒤 새 상자로 바꾼다.
- 앱 내용이 같으면(문서만 바뀐 푸시·다시 돌리기) 백업·보관을 건너뛰고 상자도 그대로 둔다 → 진짜 직전 버전이 `previous`에 그대로 남는다.
  `.env.production`만 고친 경우에도 이 스크립트를 돌리면 상자를 새로 만들어 새 값이 적용된다.
- 🔴 새 상자로 바뀐 뒤 3분 안에 정상(healthy)이 안 되면 **운영이 고장 난 채로** 끝난다(DB 구조 변경도 이미 적용됐을 수 있다) → 아래 "되돌리기".
- 배포 두 개가 겹치면 뒤의 것이 앞의 것이 끝날 때까지 기다린다(잠금 `/run/attendance-deploy.lock`, 최대 15분).

### 배포 전용 열쇠 (자동 배포용)

| 항목 | 값 |
|---|---|
| 서버 쪽 | `/root/.ssh/authorized_keys` 의 `attendance-actions-deploy` 줄. 앞에 `restrict,command="/bin/bash /opt/attendance/deploy/server/deploy.sh"` 가 붙어 있어 **deploy.sh 외에는 아무것도 못 한다** |
| 깃허브 쪽 | 저장소 Settings → Secrets and variables → Actions: `SERVER_HOST`·`SERVER_PORT`·`SERVER_USER`·`SERVER_SSH_KEY` |
| 열쇠 원본 | 깃허브 Secrets 에만 있다(PC 파일은 등록 후 지웠다). 잃거나 새면 아래처럼 새로 만든다 |

열쇠 바꾸기(새 PC에서 `ssh-keygen -t ed25519 -N '' -C attendance-actions-deploy -f 새열쇠`로 만든 뒤):
1. 서버: `authorized_keys`에서 `attendance-actions-deploy` 줄을 지우고 새 공개키를 같은 앞머리(`restrict,command=...`)로 넣는다(먼저 `cp`로 백업).
2. 깃허브: `SERVER_SSH_KEY`를 새 열쇠 내용으로 바꾼다. → Run workflow 로 확인 → PC의 열쇠 파일 삭제.
- ⚠️ 학원관리 저장소도 같은 이름(`SERVER_*`)을 쓰지만 **열쇠는 따로**다. 학원관리 열쇠를 여기 넣으면 근태 푸시가 학원관리를 배포한다.

**자동 배포 잠시 끄기 / 다시 켜기** (그 줄 맨 앞에 `#`을 붙이면 꺼진다 — 깃허브 Actions는 실패로 표시되고 운영은 그대로)
```bash
sed -i 's|^restrict,command="/bin/bash /opt/attendance/|#&|' /root/.ssh/authorized_keys      # 끄기
sed -i 's|^#\(restrict,command="/bin/bash /opt/attendance/\)|\1|' /root/.ssh/authorized_keys  # 다시 켜기
grep -n attendance-actions-deploy /root/.ssh/authorized_keys | cut -c1-40                       # 확인(# 있으면 꺼짐)
```

## 되돌리기 — 직전 이미지로

🔴 **먼저 자동 배포를 끈다**(바로 위 "끄기" 명령). 서버 코드는 여전히 고장 난 main 최신이라, 끄지 않으면 문서 하나만 푸시해도 고장 난 버전이 다시 올라간다.
고친 버전을 main에 올린다(꺼져 있으니 반영 안 됨) → 자동 배포를 다시 켠다 → Actions에서 **Run workflow**(또는 서버에서 `deploy.sh`)로 반영한다.

```bash
cd /opt/attendance
docker image tag attendance-app:previous attendance-app:latest
docker compose -f docker-compose.prod.yml up -d --no-build
```
⚠️ 새 버전이 **DB 구조를 바꿨다면**(마이그레이션 추가) 이미지만 되돌리면 안 된다 → 아래 "백업에서 되살리기"로 **반영 전 백업**도 함께 되살린다(백업 폴더에서 가장 최근 시각 파일).
되돌린 뒤 코드도 맞추려면 `git log --oneline -5`로 확인해 두고, 다음 반영은 고친 버전을 main에 올린 뒤 `deploy.sh`로 한다(옛 커밋을 checkout 한 채로 deploy.sh를 돌리면 거부된다).

## 백업에서 되살리기

```bash
cd /opt/attendance
B=/data/attendance-backups/attendance-db-<시각>.db.gz       # ← 되살릴 파일을 정확히 지정
gzip -t "$B" && echo "백업 파일 정상"                         # 1) 파일 확인 — 실패하면 여기서 멈춘다(운영 DB는 아직 그대로)
gunzip -c "$B" > /data/attendance/db/.restore.db             # 2) 임시 이름으로 먼저 푼다
docker compose -f docker-compose.prod.yml stop               # 3) 상자 멈춤
NOW=$(date +%Y%m%d-%H%M%S)
mv /data/attendance/db/attendance.db /data/attendance/db/attendance.db.before-restore-$NOW   # 4) 지금 DB 보관(시각 붙여 덮어쓰기 방지)
for x in -journal -wal -shm; do [ -f /data/attendance/db/attendance.db$x ] && mv /data/attendance/db/attendance.db$x /data/attendance/db/attendance.db$x.before-restore-$NOW; done
mv /data/attendance/db/.restore.db /data/attendance/db/attendance.db                        # 5) 교체
# 6) 사진·문서도 되살릴 때만: tar -xzf /data/attendance-backups/attendance-files-<시각>.tar.gz -C /data/attendance
chown -R 10001:10001 /data/attendance
docker compose -f docker-compose.prod.yml start                                             # 7) 다시 켬
```
- 백업 DB는 만들 때 무결성 검사를 통과한 것만 남는다(`webapp/scripts/backup-db.mjs`).
- 출퇴근 사진은 `CLOCK_PHOTO_KEY`가 같아야 열린다. 키는 백업에 들어 있지 않으므로 따로 보관한 값을 쓴다.

## 상태 보기

```bash
docker ps --filter name=attendance-app          # STATUS에 (healthy)
docker logs --tail 50 attendance-app            # 최근 기록(50MB×5개까지 자동 보관)
tail -3 /var/log/attendance-backup.log          # 그날 ✅ 줄이 있어야 정상
```
⚠️ 상태 점검(healthy)은 로그인 화면이 열리는지만 본다 — DB 고장까지는 잡지 못한다. 바깥 감시(uptime-kuma 등)는 4단계에서 붙인다.
