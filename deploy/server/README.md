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

## 처음 설치 (4단계 — 한 번만)

```bash
# 1) 데이터·백업 폴더 (상자는 uid 10001로 돈다. 다른 계정은 읽지 못하게 700)
mkdir -p /data/attendance/db /data/attendance/storage/{clock-photos,company-docs,request-attachments} /data/attendance-backups
chown -R 10001:10001 /data/attendance && chmod 700 /data/attendance /data/attendance-backups

# 2) 코드 받기 — 비공개 저장소라 "읽기 전용 배포 열쇠"를 서버에 만들어 깃허브에 등록한 뒤 clone (4단계에서 안내)
git clone git@github.com:gaon1107/attendance-management.git /opt/attendance

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

이후 nginx 주소 연결·HTTPS·요청 수 제한·운영자 화면 접속 제한은 4단계 명령서로 한다(`docs/09_test/배포전_체크리스트.md` 3·6·8번).

## 새 버전 반영

```bash
bash /opt/attendance/deploy/server/deploy.sh
```
- 깃허브에 올린다고 자동으로 반영되지 않는다(시범 기간 안전을 위해 수동).
- 스크립트가 **반영 전에 백업을 뜨고**, 직전 이미지를 `attendance-app:previous`로 남긴 뒤 새 상자로 바꾼다.

## 되돌리기 — 직전 이미지로

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
