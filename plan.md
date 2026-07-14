# Plan: 접속/보안 모니터링 (2번 화면군, 풀세트) — 2026-07-14 — 상태: 검토 대기

> 근거·영향분석: research.md. 사장님 결정(7/14): **③ 풀세트**(로그인 이력 + IP·기기 접속로그 + 이상알림 + 차단IP·자동차단).
> 큰 작업이라 **6단계로 분해**한다. 각 단계 = 독립적으로 완성·커밋·검증 가능. **한 단계 끝날 때마다 보고 후 다음 단계로.**

---

## ⚠️ 먼저 짚는 현실 (사장님 확인 필요 — 아래 "메모 공간"에 O/X)
1. **개발 PC(localhost)에서는 IP가 `127.0.0.1`로만 잡힙니다.** 진짜 외부 IP·해외 판정은 **운영 서버 배포 후**에야 보입니다. 이번엔 "구조·화면·형태"를 완성하고, 실제 값 검증은 배포 후가 됩니다. → 진행해도 될까요?
2. **이메일/SMS 실발송 수단이 아직 없습니다.** 이상 접속 알림은 이번에 **"앱 안 대시보드 알림 + 설정 화면"까지** 만들고, **이메일/SMS는 켜고 끄는 자리만 두되 실제 발송은 다음(인프라 붙일 때)**으로 둡니다. → 이 방식 OK?
3. **해외/국가 판정(GeoIP)** 은 외부 데이터가 필요합니다. 이번엔 회사 허용IP 기준 **"사내망 / 외부"까지만** 판정하고, 해외·국가 표기는 **자리만** 둡니다(나중에 GeoIP 붙이면 채워짐). → OK?
4. **자동차단**은 잘못 만들면 관리자 본인이 잠깁니다. 그래서 **"현재 접속 IP·회사 허용IP는 절대 차단 못 하게" 안전장치**를 먼저 넣고, 차단은 **로그인·출퇴근 진입점에서만** 적용(전체 미들웨어는 커스텀 Next 문서 확인 후 결정)합니다. → OK?

---

## 1. 접근 방식 (+이유)
- **데이터 수집(테이블+기록) → 화면 → 차단/알림** 순서. 화면만 먼저 만들면 빈 표가 되므로 수집을 1단계로.
- 공통 모듈(`createSession`·`getClientIp`·`ipMatches`)은 **시그니처 유지, 기록은 호출부에서 add-only**(safe-coding-skill).
- 화면은 전부 기존 공통부품 재사용: 기간 달력(`RangeCalendarNav`)·통합검색(`SearchBox`)·엑셀 내보내기 패턴·관리자 격리 패턴(`records` 표준).
- 접속기록은 **개인정보** → 보관기간(예: 1년) + 자동파기(오래된 것 정리)를 처음부터 설계.

## 2. 수정/생성 파일 목록 (단계별)
### 1단계 — 접속 데이터 수집 기반
- 생성: `webapp/prisma/schema.prisma`에 `AccessEvent` 모델 추가 + migrate.
- 생성: `webapp/lib/access-log.ts` — `recordAccess({companyId,userId?,actorName?,emailTried?,kind,result,ip,userAgent,meta?})` 한 줄 기록 헬퍼(실패해도 로그인/요청을 막지 않게 try/catch·비동기).
- 생성: `webapp/lib/device.ts` — userAgent → "iPhone / Android / PC(브라우저)" 간단 판별.
- 수정(add-only): `auth.ts`(로그인 성공/실패 기록)·`invites.ts`(가입후 로그인 기록). **`session.ts`/`createSession` 본체는 무수정.**

### 2단계 — 로그인 이력 화면(관리자 감사)
- 생성: `webapp/app/security/logins/page.tsx` + 클라이언트(목록 필터) + `export/route.ts`(엑셀).
- 수정: `Sidebar.tsx` — NavKey `security`("보안로그") 그룹 신설(add-only).

### 3단계 — IP·기기 접속 로그 화면
- 생성: `webapp/app/security/access/page.tsx`(로그인+출퇴근 접속 통합, `ipMatches`로 사내망/외부 판정) + 엑셀.
- 수정(add-only): 출퇴근 시 접속 IP·기기도 `AccessEvent`에 남기도록 `attendance.ts` **후처리 지점**(clockIn/clockOut 본체 밖)에서 기록.

### 4단계 — 관리자 감사로그 확장(설정변경·조회·파기)
- 수정(add-only): 설정 저장·생체정보 파기 등 관리자 주요 action에 `recordAccess(kind:'config'|'purge'...)` 한 줄. (건별 영향 최소)
- 2단계 화면에 "동작 유형" 필터 추가.

### 5단계 — 차단 IP 관리 + 자동차단(안전장치 포함)
- 리서치 TODO: `node_modules/next/dist/docs/`에서 미들웨어/요청 훅 방식 확인(구현 전 필수).
- 생성: `BlockedIp` 모델 + migrate. `webapp/lib/ip-block.ts` — `isBlocked(ip, company)`(+ **화이트리스트: officeIps·요청자 현재 IP는 절대 차단 안 함**).
- 생성: `webapp/app/security/blocked/page.tsx`(목록·추가·해제) + 서버액션.
- 적용: 로그인/출퇴근 진입점에서 `isBlocked` 검사(차단 시 거부+기록). 전체 미들웨어 적용은 문서 확인 후 별도 판단.

### 6단계 — 이상 접속 알림(감지 규칙 + 대시보드 알림)
- 생성: 알림설정(Company 컬럼 or `AlertRule`) + `webapp/app/security/alerts/page.tsx`(규칙 on/off·수준·채널).
- 생성: `SecurityAlert` 모델 + 감지(심야/새기기/연속실패 — 사내 데이터만으로 가능한 것부터. 해외=GeoIP 보류).
- 대시보드/알림센터에 이상접속 배지. **이메일/SMS는 채널 토글만(실발송 비활성·"준비중" 표기).**

## 3. 🛡️ 사이드 이펙트 방어
- **로그인 흐름**: 기록 실패가 로그인을 막으면 안 됨 → `recordAccess`는 try/catch, 실패는 콘솔 경고만. 로그인 성공/실패 판정 로직은 무수정.
- **출퇴근**: `attendance.ts` clockIn/clockOut **본체 무수정**(project-status 🚧 준수), 기록은 후처리에서만.
- **공통 모듈**: `createSession`·`getClientIp`·`ipMatches` 시그니처 불변(3+2곳 호출부 안전).
- **자동차단 자기잠금**: 화이트리스트(officeIps+현재 접속 IP) 예외 + 관리자 해제경로는 차단 대상에서 제외.
- **DB 마이그레이션**: 신규 테이블만 추가(기존 컬럼 무변경) → 기존 데이터 무영향.
- **구현 후 반드시 테스트할 기존 기능**: 로그인/로그아웃·초대가입·출퇴근(사내망 판정 포함)·설정 저장·기존 화면 회귀.

## 4. 작업분해 TODO
- [ ] 1-a: `AccessEvent` 모델 + migrate + `lib/access-log.ts`·`lib/device.ts` — 커밋
- [ ] 1-b: auth·invites 로그인 성공/실패 기록(add-only) — 커밋 → **보고·중간확인**
- [ ] 2: 로그인 이력 화면 + 엑셀 + 사이드바 "보안로그" — 커밋 → **보고**
- [ ] 3: IP·기기 접속 로그 화면 + 출퇴근 접속 기록 — 커밋 → **보고**
- [ ] 4: 관리자 감사로그 확장(설정변경·파기 등) — 커밋 → **보고**
- [ ] 5: (문서확인 후) 차단 IP 관리 + 자동차단(안전장치) — 커밋 → **보고**
- [ ] 6: 이상 접속 알림 설정·감지·대시보드 알림 — 커밋 → **보고**
- [ ] 각 단계: 영향받은 기존 기능 회귀 테스트
- [ ] 마지막: code-reviewer 검수 + project-status.md·PROGRESS.md 갱신

## 5. 핵심 로직 샘플 (계획용, 실제 구현 아님)
```ts
// lib/access-log.ts — 기록은 절대 본기능을 막지 않는다
export async function recordAccess(e: AccessInput): Promise<void> {
  try { await prisma.accessEvent.create({ data: { ...e, createdAt: new Date() } }); }
  catch (err) { console.warn("[access-log] 기록 실패(무시):", err); }
}
// 자동차단 화이트리스트 — 자기잠금 방지
function isBlocked(ip: string|null, company: Company, blocks: BlockedIp[]): boolean {
  if (!ip) return false;
  if (ipMatches(ip, company.officeIps)) return false;   // 사내망은 절대 차단 안 함
  return blocks.some(b => b.status === "block" && ipMatches(ip, b.pattern));
}
```

## 6. 구현하지 않을 것 (이번 범위 제외 + 이유)
- **이메일/SMS 실발송** — 발송 인프라 미결(자리·설정만). 
- **해외·국가(GeoIP) 판정** — 외부 데이터 미결(사내망/외부까지만).
- **전역 미들웨어 자동차단** — 커스텀 Next 확인 전엔 진입점(로그인·출퇴근) 한정.
- **입사일 기반 연차 자동산정** 등 2번과 무관 항목.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- 위 "먼저 짚는 현실" 1~4번에 O/X 부탁드립니다.
- 단계를 더 줄이거나(예: 1~3단계만 먼저) 순서를 바꾸고 싶으시면 여기에.
-
