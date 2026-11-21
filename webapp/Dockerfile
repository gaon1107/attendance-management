# 근태관리 운영용 Docker 상자 (2026-11-18, 운영 준비 2단계)
#
# ⚠️ 이 파일은 **운영 서버(서버 E) 전용**이다. 사장님 PC 개발은 그대로 `근태관리_실행.bat`(npm run dev)을 쓴다.
#
# 왜 이렇게 만들었나
#  · node:24-bookworm-slim — 얼굴 위조 판독(onnxruntime-node)과 Prisma가 glibc를 요구한다(alpine 금지).
#    Node 24는 개발 PC와 같은 버전이고, sharp 0.35의 조건(Node ≥ 20.10)도 만족한다.
#  · 단일 단계 빌드 — standalone 출력은 판독 모델·네이티브 파일을 추적하다 빠뜨릴 위험이 있어(빌드 경고) 쓰지 않는다.
#    상자가 1GB 안팎으로 커지지만, 서버 디스크 여유(245GB)에 비하면 안전이 우선이다.
#  · DB·사진·문서는 상자 안이 아니라 /data(호스트 폴더 연결)에 둔다 → 상자를 지우고 다시 만들어도 남는다.
FROM node:24-bookworm-slim
# 이 서비스의 이미지만 골라 정리하기 위한 표시(deploy.sh가 이 표시가 있는 옛 이미지만 지운다 — LMS 이미지는 건드리지 않음)
LABEL app=attendance

# tzdata: 한국 시간 고정(다르면 근태 날짜가 하루씩 밀린다) / openssl: Prisma 엔진 / curl: 상태 점검(healthcheck)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Seoul \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# 1) 부품 설치 — 목록 파일만 먼저 복사해, 코드만 바뀐 배포에서는 이 단계를 재사용(빌드 시간 단축)
#    --include=dev: 빌드에 TypeScript·Tailwind가 필요하다. 선택 의존성(sharp 리눅스 바이너리)을 빼면 판독이 전부 실패하므로 omit 금지.
COPY package.json package-lock.json ./
# 학원관리와 같이 쓰는 문자 모듈(@newgaon/moashot) 묶음 — package.json이 file:vendor/…로 가리키므로 npm ci 전에 있어야 한다(2026-11-21)
COPY vendor ./vendor
COPY prisma ./prisma
RUN npm ci --include=dev --no-audit --no-fund && npx prisma generate

# 2) 소스 복사 + 운영 빌드
COPY . .
RUN npx next build

# 3) 실행 준비 — 관리자 권한 없이 **근태 전용 번호(uid/gid 10001)**로 돌린다.
#    서버 E의 uid 1000은 사람 계정(user)이라, 1000으로 돌리면 그 계정이 출퇴근 사진·DB를 직접 읽고 쓸 수 있게 된다(생체정보 접근통제 위반).
#    .next는 실행 중에도 캐시를 쓰므로 이 사용자에게 넘긴다. /data는 호스트 폴더가 연결된다(호스트에서 10001 소유로 만들 것).
RUN groupadd --gid 10001 attendance \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin attendance \
 && mkdir -p /data/db /data/storage/clock-photos /data/storage/company-docs /data/storage/request-attachments \
 && chown -R 10001:10001 /app/.next /data
USER 10001:10001

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL="file:/data/db/attendance.db" \
    CLOCK_PHOTO_DIR=/data/storage/clock-photos \
    COMPANY_DOC_DIR=/data/storage/company-docs \
    REQUEST_ATTACHMENT_DIR=/data/storage/request-attachments

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:3000/login || exit 1

# 켤 때마다 DB 구조를 최신으로 맞춘 뒤(실패하면 켜지지 않는다) 운영 모드로 시작
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node_modules/.bin/next start -p 3000 -H 0.0.0.0"]
