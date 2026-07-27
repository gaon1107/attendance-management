# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 이 파일은 **기술 가이드**다. 프로젝트 운영 규칙(사규)·워크플로우는 상위 `../CLAUDE.md`, 진행 현황은 `../project-status.md`를 따른다.
> 아래 `@AGENTS.md`는 이 Next.js가 학습 데이터와 다르다는 경고다 — 코드 작성 전 반드시 읽는다.

@AGENTS.md

## 명령어 (전부 `webapp/`에서)

- **개발 서버**: `npm run dev`. 단, 실제 실행은 루트의 `근태관리_실행.bat`(사장님이 더블클릭)이 `.next` 캐시를 지운 뒤 3000 포트로 띄운다 — 오래 켜두면 `.next` 캐시가 꼬여 404가 나므로 캐시 삭제 후 재시작이 정석.
- **launch.json 서버**: `webapp`(3000, 사장님용) / `webapp-check`(3001, 검증용, 사장님 세션과 분리). 검증할 땐 3001을 쓴다.
- **타입체크**: `npx tsc --noEmit` (완료 선언 전 필수)
- **린트**: `npm run lint` 또는 특정 파일 `npx eslint <files>`
- **Prisma**: `npx prisma migrate dev` / `npx prisma generate`.
  - ⚠️ **함정**: dev 서버가 켜져 있으면 엔진 DLL 잠금(EPERM)으로 migrate/generate 실패. **스키마 바꿨으면 서버 껐다 켜기**.
  - DB는 SQLite (`DATABASE_URL`, `.env`). `.env`는 커밋 금지.

## 테스트 — 러너 없음, "임시 라우트" 패턴

자동화 테스트 프레임워크가 없다. 로직 검증은 이렇게 한다:
1. `app/api/<이름>/route.ts`에 임시 GET 라우트를 만들어 **실제 컴파일된 함수**(순수함수·`buildDayEntries`·`resolveShift` 등)를 호출하고 PASS/FAIL JSON을 반환.
2. 3001 서버를 띄우고 `curl`로 호출해 결과 확인.
3. **검증 후 임시 라우트를 반드시 삭제**한다.
- ⚠️ 밑줄(`_`)로 시작하는 폴더는 Next가 라우팅에서 제외(private folder)하므로 임시 라우트 폴더명에 `_`를 쓰지 말 것.
- 실DB 검증은 **검증DB(뉴가온)**로 하되 상태를 오염시키면 **반드시 원상복구**한다(스냅샷→변경→검증→복구). 실계정 오염 금지.

## 아키텍처 (big picture)

**멀티테넌트 근태관리 SaaS.** 회사(Company)마다 관리자(admin)·직원(employee) 두 역할. 모든 Prisma 쿼리·서버액션은 **`companyId`로 격리**한다(테넌트 격리가 최우선 불변식).

- **인증**: 세션 쿠키 → `lib/session.ts` `getCurrentUser()`(만료·퇴사 방어 포함). 비밀번호는 bcrypt. 페이지 상단에서 `redirect("/login")`·역할 체크.
- **데이터 흐름**: App Router **서버 컴포넌트**가 Prisma로 조회 → 화면. 변경은 **서버 액션**(`app/actions/*.ts`, `"use server"`)이 담당(권한·회사격리 검증 후 `revalidatePath`). 클라이언트 컴포넌트는 `useActionState`로 액션 호출.
- **도메인 로직은 `lib/`에 집중**(가능한 순수함수 → 임시 라우트로 테스트). 화면은 얇게 유지:
  - `worktime.ts` — 실근무/지각/조퇴 원자 함수(시:분 비교, 비교대용).
  - `dayentries.ts` `buildDayEntries` — **지각/조퇴/결근 판정의 중앙 허브**. 직원상세·내근태가 위임. 단, `records`·`reports`·`dashboard`는 자체 인라인 판정(중복 구현이니 판정 규칙 바꿀 땐 이 4곳 모두 확인).
  - `shift.ts`(순수)+`shift-server.ts`(로더) — **교대근무**. `loadShiftContext`가 교대제 회사면 컨텍스트를 로드(비교대면 `null`→기존 경로 그대로=회귀 0), `resolveShift`가 그날 조를 해석(예외→고정/순환→휴무), `judgeByShift`가 자정 넘김 지각/조퇴.
  - `leave.ts`(휴가 상수·헬퍼 단일 출처), `workdays.ts`(근무요일), `period.ts`(기간·`toISODate`), `overtime.ts`(주52), `notifications.ts`(관리자 알림 집계), `holiday-server.ts`(공휴일·회사휴무일 = `offDays`).
- **판정 게이트 규칙**: "근무예정일" = 근무요일(`workDays`) ∧ 쉬는날(`offDays`=공휴일+회사휴무일) 아님 ∧ (교대제면 그날 조 배정≠휴무). 이 게이트가 결근/지각 판정의 핵심.
- **날짜·TZ**: **서버 TZ=Asia/Seoul 전제**. 날짜키는 `"YYYY-MM-DD"`(로컬, `lib/period.toISODate`). 순환 단위 계산만 UTC 기반(`shift.ts` `elapsedUnits`). 자정 경계 계산이 많아 TZ 가정이 깨지면 하루 어긋난다.
- **생체정보(법적 가드레일)**: 얼굴=민감정보. 얼굴 등록/검출/인식·라이브니스는 `lib/face.ts`·`lib/liveness.ts`(+onnxruntime·sharp). 사진 90일 자동 파기(`lib/clock-photo.ts`). 얼굴인증은 강제 금지 — GPS(`lib/geocode.ts`·leaflet) 등 대체수단 병행. 상세는 상위 사규.
- **외부 연동**: 문자=아이원24(`lib/sms.ts`, EUC-KR/iconv-lite), 결제=KICC(`/kicc-test`), 엑셀=exceljs(`reports/export`).

## 관례

- **스타일**: 컴포넌트에 **인라인 style** + CSS 변수(`var(--primary)` 등, `globals.css`). Tailwind는 있으나 화면 코드는 대부분 인라인 스타일. 새 화면은 주변 코드의 색·간격 토큰을 따른다(디자인 규칙은 `webapp-design-rules` 스킬).
- **add-only 우선**: 스키마는 nullable/기본값으로 더하기(기존 회사 무영향). 판정 로직 바꿀 땐 **비교대·비교대제 경로 회귀 0**을 최우선으로 지킨다.
- 커밋은 기능 단위로. 완료 선언은 tsc·eslint 0 + 실행 증거(임시라우트/실화면) + `code-reviewer` 검수 뒤.
