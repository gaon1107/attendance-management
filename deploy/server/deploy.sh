#!/bin/bash
# 근태관리 배포(반영) (2026-11-18, 운영 준비 2-4) — 서버 E에서 사람이 직접 실행할 때만 반영된다(자동 배포 아님).
#
# 사용: bash /opt/attendance/deploy/server/deploy.sh
# 하는 일:
#   1) main 가지 위인지 확인 → 최신본 받기
#   2) 상자가 돌고 있으면 **반영 전 백업**(DB·사진) — 새 버전의 DB 구조 맞춤이 실패해도 이 시점으로 되살릴 수 있게
#   3) 지금 이미지를 attendance-app:previous 로 보관(되돌리기용)
#   4) 근태 상자만 다시 만들어 켜기 → 정상(healthy)이 될 때까지 확인 → 이 서비스의 안 쓰는 옛 이미지만 정리
# 되돌리기: 이 스크립트로 하지 않는다(항상 main 최신을 받으므로). README.md "되돌리기"를 따른다.
set -euo pipefail

APP_DIR="${ATT_APP_DIR:-/opt/attendance}"
export ATT_DATA_DIR="${ATT_DATA_DIR:-/data/attendance}"
export ATT_PORT="${ATT_PORT:-3300}"
CONTAINER="attendance-app"
COMPOSE=(docker compose -f docker-compose.prod.yml)

log() { echo "[deploy] $(date '+%F %T') $*"; }

cd "$APP_DIR"
if [ ! -f webapp/.env.production ]; then
  log "❌ webapp/.env.production 이 없습니다(목록표 webapp/.env.production.example 참고)"; exit 1
fi
if [ ! -d "$ATT_DATA_DIR/db" ]; then
  log "❌ 데이터 폴더가 없습니다: $ATT_DATA_DIR/db (README 처음 설치 1번)"; exit 1
fi
# 되돌리려고 옛 커밋을 꺼내 둔 상태에서 실행하면 아래 pull이 최신으로 다시 감아 버린다 → main 위에서만 실행
BRANCH=$(git symbolic-ref -q --short HEAD || echo "")
if [ "$BRANCH" != "main" ]; then
  log "❌ 지금 main 가지가 아닙니다(현재: ${BRANCH:-커밋 직접 꺼냄}). 되돌린 상태라면 README '되돌리기'를 따르고, 다시 따라가려면 git checkout main"; exit 1
fi

log "시작 — 현재 $(git rev-parse --short HEAD)"
git pull --ff-only origin main
log "받은 버전 $(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-60)"

# 반영 전 백업(첫 설치처럼 상자가 없으면 건너뜀). 실패하면 반영하지 않는다.
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ]; then
  log "반영 전 백업"
  bash "$APP_DIR/deploy/server/backup-attendance.sh"
  docker image tag attendance-app:latest attendance-app:previous
  log "직전 이미지를 attendance-app:previous 로 보관"
fi

"${COMPOSE[@]}" up -d --build

# 정상 확인: 최대 3분(켜질 때 DB 구조 맞춤 + 첫 화면 준비 시간)
for i in $(seq 1 36); do
  STATE=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "none")
  if [ "$STATE" = "healthy" ]; then
    log "✅ 완료 — 상자 정상(healthy)"
    # 이 서비스(app=attendance) 표시가 있는 이름 없는 옛 이미지만 정리 — LMS 등 다른 이미지는 건드리지 않는다
    docker image prune -f --filter label=app=attendance > /dev/null
    exit 0
  fi
  sleep 5
done
log "❌ 3분 안에 정상이 되지 않았습니다. 최근 기록:"
docker logs --tail 40 "$CONTAINER" 2>&1 || true
log "되돌리려면 README '되돌리기 — 직전 이미지로'를 따른다(반영 전 백업은 /data/attendance-backups 맨 아래 파일)."
exit 1
