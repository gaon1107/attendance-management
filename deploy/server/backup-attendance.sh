#!/bin/bash
# 근태관리 매일 백업 (2026-11-18, 운영 준비 2-3) — 서버 E의 /etc/cron.d/attendance-backup 이 매일 03:30 에 실행한다(등록: README.md)
#
# 하는 일: 남은 디스크 확인 → 상자 안에서 DB를 멈추지 않고 사본+무결성 검사 → 압축 → 저장 폴더(출퇴근 사진·문서) 묶음
#          → 끊김 검사 → 정식 이름 → 14일 지난 것 삭제
# 비밀값: 스크립트에 없다. 출퇴근 사진은 이미 암호화된 파일 그대로 묶는다(키는 백업에 들어가지 않는다 — 키는 따로 보관).
# 로그는 하루 한 줄: ✅ 성공 / ❌ 실패 — 그날 날짜 줄이 없으면 실패로 본다
set -euo pipefail
umask 077   # 백업에는 직원 근태·개인정보가 있으므로 관리자만 읽게

DATA_DIR="${ATT_DATA_DIR:-/data/attendance}"
BACKUP_DIR="${ATT_BACKUP_DIR:-/data/attendance-backups}"
CONTAINER="${ATT_CONTAINER:-attendance-app}"
KEEP_DAYS=14
MIN_FREE_KB=$((5 * 1024 * 1024))   # 최소 남길 공간 5GB — 같은 디스크의 LMS·홈페이지를 지키기 위해

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# 동시에 두 번 돌지 않게(새벽 정기 백업과 배포 전 백업이 겹치는 경우 등) — 이미 돌고 있으면 기다리지 않고 실패로 끝낸다
LOCK_FILE="${ATT_BACKUP_LOCK:-/run/attendance-backup.lock}"
command -v flock > /dev/null || { log "❌ 실패: 잠금 도구(flock)가 없습니다 — util-linux 설치 필요"; exit 1; }
exec 9>"$LOCK_FILE" || { log "❌ 실패: 잠금 파일을 열 수 없습니다 ($LOCK_FILE)"; exit 1; }
if ! flock -n 9; then
  log "❌ 실패: 다른 백업이 이미 실행 중입니다"; exit 1
fi

# 폴더 이름이 attendance-backups 가 아니면 멈춘다 — 잘못된 경로(예: /data)를 지우거나 권한을 바꾸지 않게
case "$BACKUP_DIR" in
  */attendance-backups) ;;
  *) log "❌ 실패: 백업 폴더 이름은 attendance-backups 여야 합니다 (받은 값: $BACKUP_DIR)"; exit 1 ;;
esac
if [ ! -d "$DATA_DIR/db" ] || [ ! -d "$DATA_DIR/storage" ]; then
  log "❌ 실패: 데이터 폴더가 없습니다 ($DATA_DIR/db, $DATA_DIR/storage)"; exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

FREE_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
case "$FREE_KB" in
  ''|*[!0-9]*) log "❌ 실패: 디스크 여유를 읽지 못했습니다 (받은 값: '$FREE_KB')"; exit 1 ;;
esac
if [ "$FREE_KB" -lt "$MIN_FREE_KB" ]; then
  log "❌ 실패: 디스크 여유 부족 (${FREE_KB}KB < ${MIN_FREE_KB}KB) — 백업하지 않음"; exit 1
fi

TS=$(date '+%Y%m%d-%H%M%S')
SNAP_HOST="$DATA_DIR/db/.backup-$TS.db"      # 상자 안 경로: /data/db/.backup-$TS.db
DB_OUT="$BACKUP_DIR/attendance-db-$TS.db.gz"
FILES_OUT="$BACKUP_DIR/attendance-files-$TS.tar.gz"

# 실패하면 만들다 만 파일을 지운다(반쪽 백업을 남기지 않는다)
cleanup() {
  rm -f "$SNAP_HOST" "$DB_OUT.part" "$FILES_OUT.part"
}
trap 'cleanup; log "❌ 실패: $LINENO 행에서 멈춤"' ERR
# 중간에 강제로 멈춰도(Ctrl+C·종료 신호) 암호화되지 않은 DB 사본이 남지 않게 지운다
trap 'cleanup; log "❌ 실패: 중간에 멈춤(신호)"; exit 1' INT TERM HUP

# 1) DB: 상자 안에서 일관된 사본 + 무결성 검사(실패 시 상자가 사본을 지우고 종료코드 1)
docker exec "$CONTAINER" node scripts/backup-db.mjs "/data/db/.backup-$TS.db" > /dev/null
gzip -c "$SNAP_HOST" > "$DB_OUT.part"
gzip -t "$DB_OUT.part"
rm -f "$SNAP_HOST"
mv "$DB_OUT.part" "$DB_OUT"

# 2) 저장 폴더(출퇴근 사진·회사 문서·신청서 첨부) — 쓰는 도중 바뀐 파일 경고는 무시(다음 날 백업이 다시 담는다)
tar -czf "$FILES_OUT.part" -C "$DATA_DIR" --warning=no-file-changed storage || [ $? -eq 1 ]
tar -tzf "$FILES_OUT.part" > /dev/null
mv "$FILES_OUT.part" "$FILES_OUT"

# 3) 오래된 백업 정리(이 폴더의 attendance-* 파일만)
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'attendance-*' -mtime +"$KEEP_DAYS" -delete

trap - ERR INT TERM HUP
log "✅ 성공: $(basename "$DB_OUT") $(du -h "$DB_OUT" | cut -f1) / $(basename "$FILES_OUT") $(du -h "$FILES_OUT" | cut -f1)"
