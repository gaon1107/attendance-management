# Research: 접속/보안 3단계 — IP·기기 접속 로그 + 출퇴근 접속 기록 + 1년 보관·자동파기 (2026-07-16)

> 사장님 결정(7/16): **접속기록 보관기간 = 1년**, 개발 PC에서 IP가 127.0.0.1로만 보이는 한계 감수하고 진행.
> (이전 2026-07-14 리서치 = 2번 화면군 전체 6단계 — plan.md에 계획 보존됨)

## 관련 파일과 역할

| 파일 | 역할 | 이번에 |
|---|---|---|
| `prisma/schema.prisma` `AccessEvent`(301~322) | 접속기록 창고. kind에 이미 `clock_in`/`clock_out` 값 정의돼 있음 | **스키마 변경 불필요** |
| `lib/access-log.ts` | `recordAccess()`(실패해도 본기능 안 막음)·`readClientMeta()` | 파기 함수 **추가만** |
| `lib/device.ts` | User-Agent → "iPhone/Windows PC" 라벨 | 그대로 사용 |
| `lib/access-labels.ts` | 동작·결과 한글 라벨. `clock_in`="출근" 이미 있음 | 그대로 사용 |
| `lib/ip.ts` | `getClientIp()`·`ipMatches()` (사내망 판정) | **무수정**(읽기만) |
| `app/actions/attendance.ts` | clockIn/clockOut 본체 | **끝에 기록 1줄 추가**(아래 참조) |
| `app/security/logins/page.tsx` | 2단계 로그인 이력 화면 — 기간달력+검색+엑셀 패턴 | 새 화면의 본보기 |
| `app/components/Sidebar.tsx` | NavKey `security` 이미 존재(진입점=`/security/logins`) | 무수정(탭 방식 채택 시) |

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳)

### `clockIn` / `clockOut` — 호출처 전수 조사 결과 **4곳**
| 호출처 | 경로 | 방식 |
|---|---|---|
| ClockInPanel.tsx:15 | 일반 출근 버튼 | `clockIn(mode, lat, lng)` |
| attendance/page.tsx:171 | 일반 퇴근 버튼 | `<form action={clockOut}>` |
| FaceClockPanel.tsx:223 | 얼굴 화면의 대체 퇴근 버튼 | `<form action={clockOut}>` |
| actions/face.ts:319·334 | **얼굴 출퇴근**(faceClockIn/faceClockOut) | 내부에서 `clockIn`/`clockOut` 재사용 |

→ **함수 안쪽 끝에 기록을 넣으면 4곳 모두 자동 커버**되고 중복도 안 생김. 반대로 호출처마다 넣으면 4곳 중 하나라도 빠질 위험 + 얼굴 경로에서 이중 기록 위험.

### `getClientIp` / `ipMatches` — 호출처 5곳 (전부 **읽기만**, 시그니처 무변경)
- `attendance.ts:40,42`(사내망 출퇴근 판정) · `settings/page.tsx:29`(현재 IP 표시) · `access-log.ts:5`(기록) · `ip.ts` 정의부

→ 이번에 **시그니처·본문 모두 안 건드림** → 출퇴근 사내망 판정 회귀 위험 없음.

## 공통 모듈 여부 / 건드리면 안 되는 부분

- **`clockIn`/`clockOut` = 공통 모듈**(4곳 사용). project-status.md 🚧에 **"본체 무수정"** 명시됨 → safe-coding-skill 절차 필요. 아래 "결론"에서 옵션 제시.
- `lib/liveness.ts` 전처리 상수 · `lib/face.ts` 판정 로직 · `.env` 비밀값 — 이번 작업과 무관, 안 건드림.

## DB·API 변경 여부, 위험 요소

- **DB 스키마 변경 없음**(AccessEvent 재사용) → ⚠️ project-status 18줄의 "3000 서버가 dev.db 점유해 migrate가 EPERM" 문제를 **이번엔 겪지 않음**.
- **N+1 없음**: 화면은 `accessEvent.findMany` 1회 + 회사 1회. 인덱스 `[companyId, createdAt]` 이미 존재 → 기간 조회에 그대로 맞음.
- **보안**: 관리자만·회사 격리(`companyId: me.companyId`) — logins 화면과 동일 패턴. 존재하지 않는 이메일의 실패기록은 companyId가 null이라 애초에 안 보임(테넌트 안전).
- **성능**: logins와 동일하게 기간 최대 92일 + `take` 상한.
- **개인정보(1년 파기)**: 스케줄러가 없는 구조 → 기존 `purgeExpiredPhotos()`(90일 사진 파기)와 **똑같은 방식**으로 해결 가능 — "하루 1회만 실제로 도는" 가드 + 관리자가 화면 열 때 `after()`로 응답 후 실행. 검증된 패턴이라 새 위험 없음.
- **알려진 한계(그대로 유지)**: `getClientIp`가 x-forwarded-for 최좌측을 신뢰 → 운영 배포 시 신뢰 프록시 1홉 필요(3단계 범위 밖, 인프라 사안).

## 결론 (계획 시 고려사항)

1. **스키마 변경이 없어** 이번 단계는 위험이 낮다. 사실상 "기록 1줄 + 화면 1개 + 파기 함수 1개".
2. **clockIn/clockOut을 어떻게 기록할지**가 유일한 판단 지점 → plan.md에서 옵션 A/B로 제시하고 사장님 선택을 받는다.
3. 화면 진입은 사이드바 항목을 늘리지 말고 **[보안로그] 안에서 탭 2개**(로그인 이력 / 접속 로그)로 가는 게 기존 UI를 안 흔든다.
4. 파기 1년(365일)은 `purgeExpiredPhotos` 패턴 복제 — 새 발명 없음.
