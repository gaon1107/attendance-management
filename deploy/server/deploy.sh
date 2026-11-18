#!/bin/bash
# 근태관리 배포(반영) (2026-11-18, 운영 준비 2-4) — 서버 E에서 사람이 직접 실행할 때만 반영된다(자동 배포 아님).
#
# 사용: bash /opt/attendance/deploy/server/deploy.sh
# 하는 일: 최신본 받기(main) → 근태 상자만 다시 만들어 켜기 → 정상(healthy)이 될 때까지 확인 → 안 쓰는 옛 상자 정리
# 상자가 켜질 때 DB 구조 맞춤(prisma migrate deploy)이 먼저 돈다. 그게 실패하면 상자가 켜지지 않고 아래 확인에서 실패로 끝난다.
# 되돌리기: README.md "되돌리기" 참고(이전 커밋으로 git checkout 후 이 스크립트를 다시 실행).
set -euo pipefail

APP_DIR="${ATT_APP_DIR:-/opt/attendance}"
export ATT_DATA_DIR="${ATT_DATA_DIR:-/data/attendance}"
export ATT_PORT="${ATT_PORT:-3300}"
CONTAINER="attendance-app"

log() { echo "[deploy] $(date '+%F %T') $*"; }

cd "$APP_DIR"
if [ ! -f webapp/.env.production ]; then
  log "❌ webapp/.env.production 이 없습니다(목록표 webapp/.env.production.example 참고)"; exit 1
fi

log "시작 — 현재 $(git rev-parse --short HEAD)"
git pull --ff-only origin main
log "받은 버전 $(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-60)"

docker compose -f docker-compose.prod.yml up -d --build

# 정상 확인: 최대 3분(켜질 때 DB 구조 맞춤 + 첫 화면 준비 시간)
for i in $(seq 1 36); do
  STATE=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "none")
  if [ "$STATE" = "healthy" ]; then
    log "✅ 완료 — 상자 정상(healthy)"
    docker image prune -f > /dev/null
    exit 0
  fi
  sleep 5
done
log "❌ 3분 안에 정상이 되지 않았습니다. 최근 기록:"
docker logs --tail 40 "$CONTAINER" 2>&1 || true
exit 1
