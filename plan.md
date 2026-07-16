# Plan: 접속/보안 3단계 — IP·기기 접속 로그 (2026-07-16) — 상태: **✅ 구현·검수 완료**

> ⚠️ 단, **보관기간(1년) 결정은 보류**로 바뀜 — code-reviewer가 "접속기록은 지워야 할 개인정보가 아니라
> **보관 의무(최소 1년, 민감정보 시스템은 2년)** 자료"라고 지적. 얼굴=민감정보를 다루므로 2년일 가능성.
> 사장님 결정(7/16): **파기 기능 끄고(PURGE_ENABLED=false) 법적 확인 후 확정.** 코드는 완성돼 있어 상수 2개만 바꾸면 켜짐.

> 근거·영향분석: research.md(2026-07-16). 전체 6단계 중 **3단계**. 1~2단계는 완료(커밋 5d596d8·8474980·daf2ce2).
> 사장님 결정(7/16): **접속기록 보관 = 1년**, 개발 PC IP 한계(127.0.0.1) 감수하고 진행.
> 남은 단계(참고): 4=관리자 감사로그 · 5=차단IP·자동차단 · 6=이상접속 알림.

---

## 1. 접근 방식 (+이유)

- **DB 창고는 그대로 쓴다.** `AccessEvent` 테이블에 "출근/퇴근" 칸이 이미 준비돼 있음 → **스키마 변경 없음** = 서버 껐다 켜는 작업(EPERM 문제) 불필요, 기존 데이터 무영향.
- **화면은 [보안로그] 안에 탭 2개**(로그인 이력 / 접속 로그)로. 사이드바 메뉴를 늘리지 않아 기존 UI를 안 흔든다.
- **1년 파기는 이미 검증된 방식 복제** — 사진 90일 파기(`purgeExpiredPhotos`)와 똑같이 "하루 1회만 실제로 도는" 방식. 새 서버·스케줄러 불필요.
- 화면 부품은 전부 재사용: 기간달력(`RangeCalendarNav`)·통합검색(`SearchBox`)·엑셀 패턴 — 2단계 로그인 이력 화면과 동일.

## 2. 🔀 사장님이 골라주실 것 — 출퇴근 접속을 어디에 기록할까

`clockIn`/`clockOut`은 **4곳에서 쓰는 공통 함수**입니다(일반 출근·일반 퇴근·얼굴 화면 퇴근·얼굴 출퇴근). 그래서 safe-coding 절차상 선택을 받습니다.

| | **옵션 A (권장)** | 옵션 B |
|---|---|---|
| 방법 | 출퇴근 함수 **맨 끝에 기록 1줄** 추가 | 함수는 안 건드리고 **호출하는 4곳에 각각** 추가 |
| 장점 | 4곳 자동 커버·빠짐 없음·중복 없음. 판정 로직 무수정 | "본체 무수정" 규칙을 글자 그대로 지킴 |
| 단점 | project-status의 "clockIn/clockOut 본체 무수정"을 **끝에 add-only로 완화** | 4곳 중 하나 빠뜨릴 위험 + 얼굴 경로는 이중 기록 위험(얼굴 출퇴근이 내부에서 또 호출) |
| 안전장치 | 기록은 `after()`로 **응답 보낸 뒤** 실행 + try/catch → 실패해도 출퇴근은 정상. 기존 코드 한 줄도 안 고치고 **끝에 덧붙이기만** | — |

→ **권장 = 옵션 A.** 이유: "본체 무수정" 규칙의 원래 목적은 *출퇴근 판정 로직을 흔들지 말라*인데, 옵션 A는 판정이 다 끝난 뒤 맨 끝에 기록만 덧붙이므로 목적을 지킵니다. 얼굴 출퇴근이 이 함수를 재사용하는 구조라 옵션 B는 오히려 버그 위험이 큽니다.
**A/B 중 하나를 아래 메모 공간에 적어주세요.**

## 3. 수정/생성 파일 목록

### 생성 (새 파일 — 기존 기능 영향 0)
- `webapp/app/security/access/page.tsx` — 접속 로그 화면(서버). 로그인+출퇴근 통합, 사내망/외부 판정
- `webapp/app/security/access/AccessLogClient.tsx` — 목록·필터(클라이언트)
- `webapp/app/security/access/export/route.ts` — 엑셀 내보내기
- `webapp/app/security/SecurityTabs.tsx` — [로그인 이력 | 접속 로그] 탭 부품

### 수정 (전부 add-only — 기존 줄 안 고침)
- `webapp/lib/access-log.ts` — `purgeExpiredAccessEvents()` **함수 추가**(365일, 하루 1회 가드). 기존 `recordAccess` 무수정
- `webapp/app/actions/attendance.ts` — 옵션 A 채택 시 clockIn·clockOut **맨 끝에 기록 1줄씩**
- `webapp/app/security/logins/page.tsx` — 탭 부품 1줄 삽입 + 파기 트리거 1줄

### 변경 없음
- `prisma/schema.prisma`(스키마 무변경) · `lib/ip.ts` · `lib/device.ts` · `lib/access-labels.ts` · `Sidebar.tsx`

## 4. 🛡️ 사이드 이펙트 방어

| 위험 | 대응 |
|---|---|
| **출퇴근이 안 찍힘/느려짐** | 기록은 `after()`(응답 후) + try/catch. 기록이 터져도 출퇴근 결과 불변. 판정·중복방지 로직 한 줄도 안 고침 |
| **얼굴 출퇴근 이중 기록** | 옵션 A는 함수 안 1곳에만 넣어 구조적으로 중복 불가 |
| **사내망 판정 깨짐** | `getClientIp`·`ipMatches` **완전 무수정**(읽기만) — 5개 호출처 안전 |
| **사진 90일 파기 오작동** | `purgeExpiredPhotos`는 손대지 않고 **별도 함수** 신설 |
| **접속기록이 남의 회사에 보임** | `companyId: me.companyId` 강제 + 관리자 role 검사 (logins 화면과 동일) |
| **화면 느려짐** | 기간 최대 92일 + `take` 상한 + 기존 인덱스 `[companyId, createdAt]` 사용 |
| **1년 파기가 실수로 최근 기록 삭제** | 커밋 전 개발 DB에서 "365일 지난 가짜 기록 1건 넣고 → 그것만 지워지고 최근 건 남는지" 실측 |

### 구현 후 반드시 테스트할 기존 기능
- [ ] 일반 출근·퇴근 (버튼) — 정상 기록되는가
- [ ] 외출·복귀
- [ ] 사무실 모드 사내망(IP) 위치 확인 — "확인됨" 그대로 나오는가
- [ ] 얼굴 출퇴근 경로(코드 회귀 확인)
- [ ] 로그인·로그아웃·로그인 실패 기록 (2단계 화면)
- [ ] 로그인 이력 화면 기간·검색·엑셀
- [ ] 출퇴근 사진 90일 파기 로직 무영향

## 5. 작업분해 TODO

- [x] 3-a: `lib/access-log.ts`에 `purgeExpiredAccessEvents()` 추가 + 파기 실측 — 커밋 `4315fa1`
- [x] 3-b: `attendance.ts` clockIn/clockOut 끝에 접속기록 add-only(옵션 A) — 커밋 `2584f7a`
- [x] 3-c: 탭 부품 + `/security/access` 화면(사내망/외부 판정·기간·검색·필터·KPI) — 커밋 `5f7ee55`
- [x] 3-d: 엑셀 내보내기 + 파기 트리거 연결 — 커밋 `5f7ee55`
- [x] 3-e: 회귀 테스트 7항목 — 전부 통과(증거는 커밋 메시지·아래 결과)
- [x] 3-f: code-reviewer 검수 → 치명1(보관기간=사장님 결정으로 파기 정지)·중간5·경미2 반영 — 커밋 `c6d1420`, 파기정지 커밋

### 검수 결과 요약 (code-reviewer, 2026-07-16)
- **치명 1**: 접속기록 1년 파기가 법정 보관의무(최소 1년, 민감정보 2년)와 충돌 가능 → **파기 정지**로 대응(사장님 결정)
- **중간 5**: ②프로토타입 키 URL 조작 500 ③근무형태 표시 죽어있음 ④기록 실패가 출퇴근 깨뜨릴 경로 ⑤파기 실패 재시도 폭주 ⑦사내망 판정 소급 재계산 → **전부 수정**
- **경미 2**: ⑨엑셀 상한 주석 ⑫탭 활성 비교 → 수정
- **통과 확인**: 회사격리 ✔ 권한 ✔ 출퇴근 본체 무수정 ✔ 중복클릭 ✔ 얼굴 이중기록 없음 ✔ 화면·엑셀 판정규칙 동일 ✔

## 6. 핵심 로직 샘플 (계획용 — 실제 구현 아님)

```ts
// lib/access-log.ts — 1년 지난 접속기록 자동 파기 (사진 90일 파기와 동일 방식)
const ACCESS_RETENTION_DAYS = 365;
let lastPurgeAt = 0;
export async function purgeExpiredAccessEvents(): Promise<void> {
  if (Date.now() - lastPurgeAt < 24 * 60 * 60 * 1000) return;  // 하루 1회만
  lastPurgeAt = Date.now();
  try {
    const cutoff = new Date(Date.now() - ACCESS_RETENTION_DAYS * 86400_000);
    const r = await prisma.accessEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (r.count) console.log(`[access-log] 보관기간(1년) 지난 접속기록 ${r.count}건 파기`);
  } catch (e) { console.warn("[access-log] 파기 실패(무시):", e); }
}

// actions/attendance.ts — clockIn 맨 끝(기존 코드 아래)에만 덧붙임. 판정 로직 무수정.
  const { ip, userAgent } = readClientMeta(await headers());
  after(() => recordAccess({ companyId: me.companyId, userId: me.id, actorName: me.name,
    kind: "clock_in", result: "success", ip, userAgent, meta: mode }));
```

## 7. 구현하지 않을 것 (이번 범위 제외 + 이유)

- **해외·국가(GeoIP) 판정** — 외부 데이터 필요. 이번엔 **사내망/외부**까지만, 국가 칸은 자리만.
- **차단·알림** — 5·6단계 몫.
- **XFF 위조 방어(신뢰 프록시)** — 인프라 사안(운영 배포 시). 코드가 아니라 서버 설정으로 해결.
- **다른 화면의 접속기록**(설정변경·조회) — 4단계 몫.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- **2번 항목 A / B 중 선택**: → **A 승인(2026-07-16 사장님)** — 출퇴근 함수 맨 끝에 add-only 기록.
- 그 외 바꾸고 싶은 점:
-
