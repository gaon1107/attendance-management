# Research: 접속/보안 모니터링 (2번 화면군) — 2026-07-14

## 목표
목업 4종을 실제 기능으로. ①관리자 로그인 이력(감사로그) ②IP·기기 접속 로그 ③이상 접속 알림 설정 ④차단 IP 관리.
사장님 결정(2026-07-14): **③ 풀세트**(차단IP·자동차단·알림까지) — 단, 아래 제약을 정직히 반영해 단계로 진행.

## 관련 파일과 역할 (현재 코드)
- `webapp/prisma/schema.prisma` — `Session`(token·userId·expiresAt·createdAt **뿐**, IP/기기/이력 없음). `Company.officeIps`(사내 허용 IP CSV, **허용목록**이지 차단목록 아님). `User.failedLoginCount`/`lockedUntil`(로그인 실패 카운터·잠금 — 이력은 없음).
- `webapp/lib/ip.ts` — `getClientIp(headers)`(XFF/x-real-ip에서 IP 추출), `ipMatches(ip, csv)`(대역 경계 안전 매칭). **이미 존재·검증됨.**
- `webapp/lib/session.ts` — `createSession(userId)`(토큰 발급+쿠키, **IP·헤더 접근 없음**), `getCurrentUser()`, `destroySession()`. **공통 모듈**(auth·invites가 사용).
- `webapp/app/actions/auth.ts` — 로그인(42)·로그인후처리(100)에서 `createSession`. 여기서 headers() 접근 가능.
- `webapp/app/actions/invites.ts` — 초대가입 후 자동로그인(85)에서 `createSession`.
- `webapp/app/actions/attendance.ts` — 출퇴근 시 `getClientIp`+`ipMatches`로 사내망 확인(결과만 `Attendance.locationStatus`에 저장, **IP 원문·기기 미저장**).
- `webapp/app/settings/page.tsx` — 관리자에게 "현재 내 IP" 표시(허용목록 설정 도우미).
- 공통 UI: `RangeCalendar`/`RangeCalendarNav`(기간 달력), `SearchBox`+`lib/search`(OR 검색), 엑셀 내보내기 패턴(`app/reports/export/route.ts`, `app/leave-summary/export/route.ts`). **재사용 대상.**
- 사이드바 `webapp/app/components/Sidebar.tsx` — 목업의 "보안로그" 메뉴 신설 필요(NavKey 추가).

## 🔴 영향 범위 (수정 대상을 쓰는 모든 곳)
- **`createSession`(공통)**: auth.ts(로그인 2곳)·invites.ts(가입후 로그인) 3곳에서 호출. → 시그니처를 바꾸면 3곳 영향. **대응: 시그니처 불변. IP·기기 기록은 호출부(action)에서 별도로 남긴다(add-only).**
- **`getClientIp`/`ipMatches`(공통)**: attendance.ts·settings/page.tsx 사용 중. → **읽기만 재사용, 수정 안 함.**
- **자동차단 관문**: "모든 요청을 가로채는" 지점이 필요(미들웨어 또는 요청 진입점). 이건 로그인·출퇴근·조회 **전 기능에 영향** → 최우선 위험. 잘못하면 관리자 본인이 잠김.
- **감사로그(설정변경·파기)**: settings 저장, 생체정보 파기 등 여러 action에 "기록 한 줄" 추가 필요 → 각 파일 add-only.
- **Prisma 스키마 변경**: 새 테이블 추가는 `prisma migrate`(개발 SQLite) 필요. 기존 테이블 컬럼은 건드리지 않음(추가만).

## 공통 모듈 여부 / 건드리면 안 되는 부분
- `createSession`·`getClientIp`·`ipMatches`·`getCurrentUser` = **공통. 시그니처 유지, 추가만.** (safe-coding-skill 준수)
- `attendance.ts` clockIn/clockOut 본체 = 라이브니스 이식 후 **무수정 유지 대상**(project-status 🚧). 접속로그 기록은 별도 지점에서.

## DB·API 변경 여부, 위험 요소
- **DB 신규 테이블 필요**:
  - `AccessEvent`(접속/로그인 이력·감사 통합) — companyId·userId?·actorName?·emailTried?·kind·result·ip·userAgent·meta?·createdAt (+인덱스 companyId,createdAt). 화면별로 kind 필터.
  - `BlockedIp`(차단 목록) — companyId·pattern·reason·status(block/watch)·hits·createdBy·createdAt.
  - 알림설정 — Company 컬럼 확장(규칙 on/off·수준·채널) 또는 신규 테이블.
  - (선택) `SecurityAlert`(발생한 이상접속) — 대시보드 알림용.
- **위험 요소**:
  1. **자기잠금**: 자동차단이 관리자/사내망 IP를 막으면 서비스 마비. → 화이트리스트(officeIps·현재 접속 IP) 예외 + 해제경로 항상 열림 **필수 설계**.
  2. **localhost 한계**: 개발 PC에선 IP가 `127.0.0.1`/null. 진짜 외부 IP·해외판정은 **운영(프록시 뒤) 배포 후에만** 유효. 지금은 "구조·형태 확인" 단계.
  3. **인프라 부재**: 이메일/SMS 실발송 수단 없음, GeoIP(해외·국가 판정) DB/API 없음. → 이번엔 "설정·형태·대시보드 알림"까지, **실발송·해외판정은 보류(자리만 마련)**.
  4. **개인정보**: 접속기록(IP·기기)은 개인정보. 보관기간·목적 정의 필요(정보통신망법상 접속기록 보관은 오히려 의무에 가까움). 보관기간·자동파기 계획 포함.
  5. **커스텀 Next**: `webapp/AGENTS.md` 경고 — 미들웨어/요청 훅 구현 전 `node_modules/next/dist/docs/` 확인 필수(자동차단 단계 첫 TODO).
  6. **성능**: 접속 이벤트는 다량 누적 → 인덱스·기간필터·자동파기 필요. 로그 기록이 로그인/요청을 느리게 하면 안 됨(비동기/after 고려).

## 결론 (계획 시 고려사항)
- 풀세트는 **6단계로 분해**해 각 단계를 독립 커밋·검증한다(plan.md).
- **데이터 수집(테이블+기록)부터** 깐 뒤 화면을 얹는다. 화면만 먼저 만들면 빈 표가 된다.
- **자동차단·알림 실발송은 가장 마지막**, 자기잠금 방어 설계를 먼저 확정하고 착수.
- 이메일/SMS 실발송·GeoIP 해외판정은 **인프라 결정 전까지 "형태·설정까지"만**(사장님 plan 검토 시 최종 확인).
