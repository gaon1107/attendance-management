# Plan: 접속/보안 4단계 — 관리자 감사로그 (2026-07-16) — 상태: **✅ 승인됨 · 구현 중**

> 범위 확정(사장님, 7/16): 계획대로 **설정 5종 + 생체정보 파기 3종**. 직원관리(퇴사·비번재설정)는 이번 제외.

> 근거·영향분석: research.md(2026-07-16). 전체 6단계 중 **4단계**. 1~3단계 완료.
> 남은 단계: 5=차단IP·자동차단 · 6=이상접속 알림.

---

## 1. 무엇을 만드나 (쉬운 말)

지금은 **"누가 들어왔나"(로그인·출퇴근)** 만 기록됩니다. 4단계는 **"관리자가 뭘 건드렸나"** 를 남깁니다.

> 예: *"홍길동 관리자가 7/16 14:20에 **사내 허용 IP를 바꿨다**"*
> 예: *"홍길동 관리자가 7/16 14:25에 **박성헌의 생체정보를 파기했다**"*

왜 필요하냐면 — 나쁜 마음을 먹은 관리자가 **허용 IP를 몰래 넓혀놓고** 외부에서 출근을 찍거나,
직원 생체정보를 함부로 지워도 지금은 **아무 흔적이 안 남습니다.** 생체정보 파기 이력은 법적으로도 중요합니다.

## 2. 접근 방식 (+이유)

- **창고·화면을 새로 안 만든다.** `AccessEvent`에 `config`(설정 변경)·`purge`(생체정보 파기) 칸이 **이미 준비**돼 있고
  한글 라벨도 이미 있음 → **스키마 변경 0**, 3단계 화면에 **필터 한 칸만 추가**.
- 기록은 **각 동작이 성공한 지점에만** add-only 한 줄. 판정·검증 로직은 안 건드림.
- **바꾼 값은 안 남기고 "어느 설정을 바꿨다"는 이름만** 남김 → 로그로 개인정보·비밀값이 새지 않게.

## 3. 수정/생성 파일 목록 (전부 add-only)

| 파일 | 무엇 |
|---|---|
| `actions/settings.ts` | 설정 저장 5곳(위치·**사내IP**·얼굴기준·판독기준·근무규칙) 성공 지점에 `config` 기록 |
| `actions/authmethod.ts` | `adminRevokeBiometric`(관리자 파기)·`withdrawBiometric`·`chooseGps`(본인 철회)에 `purge` 기록 |
| `app/security/access/AccessLogClient.tsx` | 동작 필터에 **"관리자 동작"** 버튼 추가 |
| `app/security/access/page.tsx` · `export/route.ts` | 조회 종류에 `config`·`purge` 포함 |

**변경 없음**: `prisma/schema.prisma` · `lib/access-log.ts` · `lib/access-labels.ts` · `lib/ip.ts` · `Sidebar.tsx`

## 4. 🛡️ 사이드 이펙트 방어

| 위험 | 대응 |
|---|---|
| **🔴 `redirect()`가 기록을 삼킴** | `chooseGps`·`withdrawBiometric`은 `redirect()`로 끝나는데, redirect는 **예외를 던져** 뒤 코드를 실행 안 함 → **기록을 redirect 앞에** 배치. 또 **try/catch가 redirect 예외를 삼키면 화면 이동이 깨짐** → 기록만 감싸고 redirect는 밖에 |
| **실패했는데 기록됨** | settings 함수는 `{error}` 조기 return 구조 → **성공 지점(update 뒤)에만** 기록 |
| **기록 실패가 본기능 차단** | 3단계와 동일 — `recordAccess` 자체 try/catch + 호출부도 try/catch |
| **로그로 비밀값 유출** | 바꾼 값은 안 남기고 **설정 이름만**(예: `office_network`) |
| **회사 격리** | `adminRevokeBiometric`은 기존 companyId 검사 **뒤에** 기록 |
| **기존 화면 깨짐** | 조회 종류만 늘림 — 로그인 이력 화면은 `AUTH_KINDS` 그대로라 **영향 없음** |

### 구현 후 반드시 테스트할 기존 기능
- [ ] 설정 5종 저장 → 값이 실제로 저장되는가 (특히 사내 IP — 출퇴근 위치확인의 기준)
- [ ] 설정 저장 **실패**(잘못된 값) 시 → 에러 뜨고 **기록은 안 남는가**
- [ ] 직원 본인 철회 → **화면 이동(redirect)이 정상**인가 + 기록 남는가
- [ ] 관리자 파기 → 생체정보 목록 반영 + 기록 남는가
- [ ] 출퇴근·로그인·접속로그 화면 회귀
- [ ] 로그인 이력 화면에 관리자 동작이 안 섞이는가

## 5. 작업분해 TODO

- [ ] 4-a: `settings.ts` 5곳에 `config` 기록(add-only) — 커밋
- [ ] 4-b: `authmethod.ts` 3곳에 `purge` 기록(**redirect 순서 주의**) — 커밋
- [ ] 4-c: 접속 로그 화면·엑셀에 "관리자 동작" 필터 추가 — 커밋
- [ ] 4-d: 위 6항목 회귀 테스트(실행 증거 확보)
- [ ] 4-e: code-reviewer 검수 → 치명·중간 수정 → 문서 갱신

## 6. 핵심 로직 샘플 (계획용 — 실제 구현 아님)

```ts
// settings.ts — 성공한 뒤에만, 값이 아니라 "어느 설정"인지만 남긴다
  await prisma.company.update({ ... });
  await logAdminAction(me, "config", "office_network");   // ← 여기만 추가
  revalidatePath("/settings");
  return { ok: true };

// authmethod.ts — ⚠️ redirect 앞에! (redirect는 예외를 던져 뒤 코드를 안 돌린다)
  await purgePhotosSafely(me.id);
  await logAdminAction(me, "purge", "self_withdraw");     // ← redirect 앞
  revalidatePath("/auth-method");
  redirect("/attendance");                                 // ← try/catch로 감싸면 안 됨
```

## 7. 구현하지 않을 것 (범위 제외 + 이유)

- **회사정보·첨부문서·직원관리(퇴사·비번재설정) 기록** — 관리자 행위지만 이번 범위 밖. 2차 검토 후 추가(같은 방식이라 쉽게 확장 가능).
- **사진 열람 기록** — 이미 자체 열람기록이 있음(중복 방지).
- **본인 동의(agreeBiometric)** — 동의 시각이 `User.faceConsentAt`에 이미 남음.
- **바뀐 값의 before/after 비교** — 로그 유출 위험 + 범위 확대. "어느 설정을 바꿨다"까지만.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- 위 3번 표에서 **빼거나 추가할 항목**이 있으면 여기에.
- 특히 7번 "구현하지 않을 것"의 **직원관리(퇴사·비번재설정) 기록**을 이번에 같이 넣을지:
-
