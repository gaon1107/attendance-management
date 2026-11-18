# 근태관리 운영 서버(서버 E) 안내서

> 2026-11-18 운영 준비 2단계에서 만들었다. **실제 서버 설치는 4단계**에서 이 안내서대로 한다.
> 서버 E = gaon-main(115.68.195.240, Ubuntu 24.04). 사장님 PC PowerShell에서 `ssh gaon-main`으로 접속한다(열쇠 전용).

## 구성 한눈에

| 항목 | 위치·값 |
|---|---|
| 코드 | `/opt/attendance` (깃허브 `gaon1107/attendance-management` main) |
| 데이터(DB·출퇴근 사진·문서) | `/data/attendance` → 상자 안 `/data` |
| 백업 | `/data/attendance-backups` (매일 03:30, 14일 보관) |
| 운영 설정값 | `/opt/attendance/webapp/.env.production` (깃 제외, 목록표: `webapp/.env.production.example`) |
| 상자 이름·연결 | `attendance-app`, 서버 안 `127.0.0.1:3300` (바깥은 nginx `attend.newgaon.com` HTTPS로만) |

LMS(`/opt/newgaon-LMS`, `lms-*` 상자)·홈페이지 등 **다른 서비스의 파일·상자·설정은 건드리지 않는다.**

## 처음 설치 (4단계 — 한 번만)

```bash
# 1) 데이터·백업 폴더 (상자는 uid 1000으로 돈다)
mkdir -p /data/attendance/db /data/attendance/storage/{clock-photos,company-docs,request-attachments} /data/attendance-backups
chown -R 1000:1000 /data/attendance && chmod 700 /data/attendance /data/attendance-backups

# 2) 코드 받기 — 비공개 저장소라 "읽기 전용 배포 열쇠"를 서버에 만들어 깃허브에 등록한 뒤 clone (4단계에서 안내)
git clone git@github.com:gaon1107/attendance-management.git /opt/attendance

# 3) 운영 설정값 — 목록표를 복사해 값을 채운다. CLOCK_PHOTO_KEY는 여기서 새로 만들고 즉시 따로 보관
cp /opt/attendance/webapp/.env.production.example /opt/attendance/webapp/.env.production
chmod 600 /opt/attendance/webapp/.env.production
openssl rand -hex 32     # ← 이 값을 CLOCK_PHOTO_KEY 에 넣는다(잃으면 사진 복구 불가)

# 4) 첫 반영
bash /opt/attendance/deploy/server/deploy.sh

# 5) 매일 백업 등록
echo '30 3 * * * root bash /opt/attendance/deploy/server/backup-attendance.sh >> /var/log/attendance-backup.log 2>&1' > /etc/cron.d/attendance-backup
```

이후 nginx 주소 연결·HTTPS·요청 수 제한·운영자 화면 접속 제한은 4단계 명령서로 한다(`docs/09_test/배포전_체크리스트.md`).

## 새 버전 반영

```bash
bash /opt/attendance/deploy/server/deploy.sh
```
깃허브에 올린다고 자동으로 반영되지 않는다(시범 기간 안전을 위해 수동). 반영 전에 `bash /opt/attendance/deploy/server/backup-attendance.sh`로 백업을 한 번 떠 두면 안전하다.

## 되돌리기

```bash
cd /opt/attendance && git log --oneline -5          # 돌아갈 커밋 확인
git checkout <커밋번호> && ATT_DATA_DIR=/data/attendance docker compose -f docker-compose.prod.yml up -d --build
# 정상 확인 뒤 다시 main을 따라가려면: git checkout main
```
⚠️ DB 구조가 바뀐 버전(마이그레이션 추가)을 되돌릴 때는 코드만 되돌리면 안 된다 — 반영 전에 뜬 백업으로 DB도 함께 되살린다(아래).

## 백업에서 되살리기

```bash
cd /opt/attendance
docker compose -f docker-compose.prod.yml stop                       # 1) 상자 멈춤
cp /data/attendance/db/attendance.db /data/attendance/db/attendance.db.before-restore   # 2) 지금 DB 보관
gunzip -c /data/attendance-backups/attendance-db-<시각>.db.gz > /data/attendance/db/attendance.db   # 3) DB 되살림
tar -xzf /data/attendance-backups/attendance-files-<시각>.tar.gz -C /data/attendance             # 4) 사진·문서(필요할 때만)
chown -R 1000:1000 /data/attendance
ATT_DATA_DIR=/data/attendance docker compose -f docker-compose.prod.yml start                      # 5) 다시 켬
```
출퇴근 사진은 `CLOCK_PHOTO_KEY`가 같아야 열린다. 키는 백업에 들어 있지 않으므로 따로 보관한 값을 쓴다.

## 상태 보기

```bash
docker ps --filter name=attendance-app          # STATUS에 (healthy)
docker logs --tail 50 attendance-app            # 최근 기록(50MB×5개까지 자동 보관)
tail -3 /var/log/attendance-backup.log          # 그날 ✅ 줄이 있어야 정상
```
