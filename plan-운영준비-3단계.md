# Plan: 운영 준비 3단계 — 운영자 화면 완성 (2026-11-18) — 상태: 승인됨("추천대로 진행")

> 6단계 전체표는 `project-status.md` 맨 위. 8월 운영자 백오피스 1단계 ①(로그인 문)의 뒤를 잇는다(②=회원사 목록).
> 결정(사장님): 고객사 대시보드 문구 = "무료 이용 기간: YYYY년 M월 D일까지 (N일 남음)" / 끝나면 "무료 이용 기간이 끝났습니다. 결제 안내를 준비 중이며, 그때까지는 그대로 사용하실 수 있습니다." / 회원사 목록에 고객사 담당자 이름·연락처 표시.

## 1. 접근 방식
- **3-1** `Company.trialEndsAt DateTime?` 추가(add-only). null이면 지금처럼 가입일+30일. 값이 있으면 그 날짜의 **다음 날 자정**에 만료(=그 날짜까지 무료).
  `lib/trial.ts trialStatus(signedUpAt, now, endsOverride?)` — 세 번째 인자만 추가(기존 호출은 그대로 동작). 대시보드 문구 교체.
- **3-2** `/operator` 회원사 목록: 회사명·가입일·무료 끝·남은 일수·상태·재직 직원 수·최근 7일 출퇴근 건수·마지막 출퇴근·담당자 이름/연락처·시험회사 표시.
  검색(회사명)·상태 필터(체험 중/7일 이내/끝남/시험)·50개씩. 조회 횟수 고정(회사 목록 1 + groupBy 2 + 합계) — 회사 수에 비례하지 않게.
- **3-3** `/operator/companies/[id]`: 요약(합계만) + 무료 끝 날짜 지정(+30/+90일 단추, 비우면 기본 30일로 복귀) + 시험회사 표시 켜기/끄기.
  변경·열람은 AccessEvent(companyId=null, actorName "운영자 이름", kind config/data_view, meta=무엇을·어느 회사)로 기록. 서버 액션마다 운영자 세션 재확인.
- **3-4** `/operator/access`: 운영자 기록(companyId=null & actorName "운영자…")만 기간·종류별 50개씩.
- 직원 개인(이름·개별 근태·얼굴)은 어디에도 표시하지 않는다.

## 2. 수정/생성 파일
- 수정: `prisma/schema.prisma`(+1칸) + 새 마이그레이션, `lib/trial.ts`, `app/dashboard/page.tsx`(띠 문구), `app/operator/page.tsx`, `app/actions/operator.ts`(또는 새 `app/actions/operator-companies.ts`)
- 새: `lib/operator-companies.ts`(목록·상세 조회), `app/operator/companies/[id]/page.tsx`(+폼), `app/operator/access/page.tsx`, 운영자 상단 메뉴 컴포넌트

## 3. 사이드 이펙트 방어
- `lib/trial.ts`는 대시보드·홈화면(TRIAL_DAYS)이 쓴다 → 세 번째 인자 생략 시 결과 동일(기존 6개 회사 회귀 0을 실행으로 확인), TRIAL_DAYS 값 불변.
- 마이그레이션은 nullable 칸 1개 — 기존 행 영향 없음. 개발 3000 서버는 끝에 한 번만 껐다 켠다(별도 작업 복사본에서 개발·검증).
- 테스트: 기존 회사 대시보드 띠 문구/날짜 / 운영자 목록·검색·필터·페이지 / 무료 끝 지정→고객 대시보드 반영→되돌리기 / 기록 남는지 / 비로그인 접근 차단 / tsc·eslint 회귀 0. 검증 데이터는 원상복구.

## 4. TODO
- [ ] 3-1 무료기간 칸·계산·대시보드 문구
- [ ] 3-2 회원사 목록
- [ ] 3-3 회사 상세·무료기간·시험회사 표시(기록 포함)
- [ ] 3-4 운영자 접속 기록 화면
- [ ] 실행 검증 + code-reviewer
- [ ] 본 폴더 반영(서버 끄고 migrate deploy·generate → 재시작) + 현황판

## 6. 구현하지 않을 것
결제·만료 시 차단(결제와 한 세트) / 운영자 2단계 인증(H-5 — 4단계 nginx 사내 IP 제한으로 대신, 고객 늘면 재검토) / 엑셀 내보내기 / 운영자 계정 관리 화면(서버 명령으로만, 일부러)
