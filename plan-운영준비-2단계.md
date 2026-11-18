# Plan: 운영 준비 2단계 — 운영 실행 준비(Docker) (2026-11-18) — 상태: 승인됨("추천대로 진행")

> 6단계 전체표는 `project-status.md` 맨 위. 이 문서는 2단계 상세다.
> 결정: 운영 서버 = 서버 E(gaon-main) · 주소 `attend.newgaon.com` · **시범 기간 문자(SMS) 끔**(초대는 링크 복사, M7은 문자 켤 때 함께).

## 1. 접근 방식
LMS와 같은 Docker 방식. 이번 단계는 **서버에 아무것도 설치하지 않고**, 이 PC의 Docker Desktop으로 상자를 실제로 띄워 검증까지만 한다(서버 설치는 4단계).
- 베이스 `node:24-bookworm-slim`(onnxruntime-node·Prisma가 glibc 필요 → alpine 금지, Node 24 = 개발과 동일, sharp 0.35의 Node≥20.10 조건 충족)
- 단일 단계 빌드(`npm ci --include=dev` → `prisma generate` → `next build`) — standalone은 모델·네이티브 파일 추적 누락 위험(빌드 경고)이 있어 쓰지 않는다
- 실행: `prisma migrate deploy` → `next start`(NODE_ENV=production), 비루트(node, uid 1000), TZ=Asia/Seoul
- 데이터: 컨테이너 `/data` 하나에 DB(`/data/db`)와 저장 폴더 3개(`/data/storage/*`)를 둔다 → 호스트 `ATT_DATA_DIR`(서버: `/data/attendance`)에 바인드
- 연결: `127.0.0.1:3300` → 컨테이너 3000(외부 직접 노출 없음, 4단계 nginx가 앞에 선다)
- 메모리 상한 1.5GB, 로그 50MB×5 자동 정리, 헬스체크 `/login`

## 2. 수정/생성 파일
- 새: `webapp/Dockerfile`, `webapp/.dockerignore`, `docker-compose.prod.yml`, `webapp/.env.production.example`, `webapp/scripts/backup-db.mjs`, `deploy/server/backup-attendance.sh`, `deploy/server/deploy.sh`, `deploy/server/README.md`
- 수정: `lib/face.ts`(M9, 2~3줄), `.gitignore`(운영 설정·로컬 데이터 폴더 제외)
- 손대지 않음: `근태관리_실행.bat`, 3000번 개발 서버, 화면·서버액션 코드

## 3. 사이드 이펙트 방어
- `lib/face.ts`는 얼굴 등록·얼굴 출퇴근·판독 공용 → https 아닌 주소일 때만 막히고(개발 주소는 https라 무영향), 수정 후 얼굴 화면 확인
- 개발 환경(.env, dev.db, storage/)은 그대로 — Docker는 별도 데이터 폴더만 쓴다
- 구현 후 테스트: 빈 DB 가입→초대링크 가입→출근·외출·퇴근 / 컨테이너 안 판독 점수 16건 = 1단계 기준값 / 상자 재생성 후 데이터 유지 / 백업→복원 / tsc·eslint 회귀 0

## 4. TODO
- [ ] 2-1 Docker 상자 설정 (Dockerfile·.dockerignore·compose)
- [ ] 2-2 설정값 목록표(.env.production.example — 값 없이 이름·설명만)
- [ ] 2-3 매일 자동 백업(DB 무중단 복사 VACUUM INTO + 무결성 검사, 저장 폴더 묶음, 14일, 디스크 여유 확인)
- [ ] 2-4 배포 스크립트·안내서(수동 실행 시에만 반영)
- [ ] 2-5 M9 얼굴서버 https 강제
- [ ] 2-6 이 PC Docker로 실제 시험(위 4종)
- [ ] 2-7 code-reviewer 검수 + 체크리스트·현황판 갱신

## 6. 구현하지 않을 것
서버 E 설치·주소·HTTPS·외부 보관소 백업 연결(4단계) / 운영자 화면(3단계) / 운영 얼굴 계정(5단계) / M7 문자 상한(문자 켤 때) / 자동 배포(깃허브 푸시 시 자동 반영 — 시범 기간엔 수동이 안전)
