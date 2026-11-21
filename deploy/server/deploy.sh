#!/bin/bash
# 근태관리 배포(반영) (2026-11-18, 운영 준비 2-4)
# 2026-11-21부터 깃허브 main 푸시 때 자동으로도 실행된다(.github/workflows/deploy.yml → 배포 전용 열쇠의 강제명령).
# 사람이 직접 실행하는 방법도 그대로 쓸 수 있다.
#
# 사용: bash /opt/attendance/deploy/server/deploy.sh
# 하는 일:
#   1) main 가지 위인지 확인 → 최신본 받기
#   2) 새 이미지 만들기(상자는 아직 그대로 — 빌드 실패면 여기서 멈춤, 운영 영향 없음)
#   3) 이미지가 지금 것과 같으면(문서만 바뀐 푸시 등) 백업·보관 없이 4)로. 다르면:
#      상자가 돌고 있을 때 **반영 전 백업**(DB·사진) + 지금 돌던 이미지를 attendance-app:previous 로 보관(되돌리기용)
#   4) 근태 상자만 다시 만들어 켜기(바뀐 게 없으면 그대로) → 정상(healthy) 확인 → 이 서비스의 안 쓰는 옛 이미지만 정리
#   ⚠️ 새 상자로 바뀐 뒤 3분 안에 healthy 가 안 되면 운영이 고장 난 상태로 남는다(DB 구조 변경도 이미 적용됐을 수 있음)
#      → README "되돌리기"로 직접 되돌린다. 그래서 푸시(=반영)는 근무시간 밖에 한다.
# 되돌리기: 이 스크립트로 하지 않는다(항상 main 최신을 받으므로). README.md "되돌리기"를 따른다.
set -euo pipefail

APP_DIR="${ATT_APP_DIR:-/opt/attendance}"
export ATT_DATA_DIR="${ATT_DATA_DIR:-/data/attendance}"
export ATT_PORT="${ATT_PORT:-3300}"
CONTAINER="attendance-app"
COMPOSE=(docker compose -f docker-compose.prod.yml)

log() { echo "[deploy] $(date '+%F %T') $*"; }

# ── 깃허브 자동 배포(강제명령 열쇠)로 불렸을 때: 접속과 떼어 서버에서 끝까지 돌린다 ──
# 접속이 끊기면(시간 초과·Actions 취소·네트워크) 다음 글자를 출력하는 순간 스크립트가 죽어 상자 교체 도중 멈출 수 있다.
# 그래서 본 작업은 새 세션(setsid)으로 돌려 기록 파일에 쓰고, 접속 쪽은 그 기록을 보여 준 뒤 결과(종료 코드)만 돌려받는다.
# SSH_ORIGINAL_COMMAND 는 강제명령 열쇠로 들어왔을 때만 생긴다 — 사람이 직접 돌릴 때는 이 부분을 건너뛴다(화면에 그대로 출력).
if [ -n "${SSH_ORIGINAL_COMMAND:-}" ] && [ -z "${ATT_DEPLOY_DETACHED:-}" ]; then
  DEPLOY_LOG="${ATT_DEPLOY_LOG:-/var/log/attendance-deploy.log}"
  SELF="$(readlink -f "$0")"
  touch "$DEPLOY_LOG"
  OFFSET=$(( $(stat -c %s "$DEPLOY_LOG") + 1 ))
  ATT_DEPLOY_DETACHED=1 setsid -w nohup /bin/bash "$SELF" < /dev/null >> "$DEPLOY_LOG" 2>&1 &
  PID=$!
  tail -c +"$OFFSET" -f --pid="$PID" "$DEPLOY_LOG" || true
  RC=0; wait "$PID" || RC=$?
  exit "$RC"
fi

# 배포가 두 개 겹치지 않게 잠근다(자동 배포 도중 사람이 또 돌리는 경우 등). 앞 배포가 끝날 때까지 최대 15분 기다린다.
# 백업 스크립트의 잠금(/run/attendance-backup.lock)과는 다른 파일이다.
DEPLOY_LOCK="${ATT_DEPLOY_LOCK:-/run/attendance-deploy.lock}"
command -v flock > /dev/null || { log "❌ 잠금 도구(flock)가 없습니다 — util-linux 설치 필요"; exit 1; }
exec 8>"$DEPLOY_LOCK" || { log "❌ 잠금 파일을 열 수 없습니다 ($DEPLOY_LOCK)"; exit 1; }
if ! flock -n 8; then
  log "다른 배포가 진행 중입니다 — 끝날 때까지 기다립니다(최대 15분)"
  flock -w 900 8 || { log "❌ 15분 넘게 다른 배포가 끝나지 않아 멈춥니다"; exit 1; }
fi

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

# 지금 돌고 있는 상자의 이미지(되돌리기용)를 먼저 적어 둔다
RUNNING=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)
RUNNING_IMG=$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "")

# 새 이미지를 먼저 만든다 — 상자는 아직 그대로 돈다. 빌드가 실패하면 여기서 멈추고 운영은 영향이 없다.
log "새 이미지 만들기"
"${COMPOSE[@]}" build
NEW_IMG=$(docker image inspect -f '{{.Id}}' attendance-app:latest)

if [ -n "$RUNNING_IMG" ] && [ "$RUNNING_IMG" = "$NEW_IMG" ]; then
  # 문서만 바꾼 푸시·다시 돌리기 등. 여기서 previous 를 다시 붙이면 진짜 직전 버전이 이름을 잃고 정리돼 되돌릴 수 없게 된다.
  log "앱 내용 변화 없음(이미지 같음) — 반영 전 백업·직전 이미지 보관을 건너뜀"
elif [ "$RUNNING" = "true" ]; then
  # 반영 전 백업(첫 설치처럼 상자가 없으면 건너뜀). 실패하면 반영하지 않는다.
  log "반영 전 백업"
  bash "$APP_DIR/deploy/server/backup-attendance.sh"
  docker image tag "$RUNNING_IMG" attendance-app:previous
  log "직전 이미지를 attendance-app:previous 로 보관"
fi

# 이미지나 설정(.env.production 등)이 바뀌었을 때만 상자를 새로 만든다. 둘 다 그대로면 상자도 그대로다.
"${COMPOSE[@]}" up -d --no-build

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
