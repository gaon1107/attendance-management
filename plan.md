# Plan: 라이브니스 후속 3건 (2026-07-11) — 상태: ✅ 완료(구현·검증·검수 반영, 커밋 4d28307~203708f)
> 근거·영향 범위는 research.md. 이전 계획(데모 검증 결과의 근태 적용 — 이 계획의 원형)은 git 이력에 보존.

## 0. 데모 테스트에서 확인된 사실 (계획의 근거)
- 폰 화면 공격: 진짜 확률 0% → 잘 잡힘 / **오려서 구부린 인쇄 사진: 78~85%로 "진짜" 오판**(모델B는 60~77%로 의심)
- 사장님 결정: 차단 기준은 운영하며 조정 / 최종 안전망 = 관리자 사진 열람

## 1. 접근 방식 (+이유)
- **① 판정 기준값 설정화**: 이미 검증된 faceMinPercent 패턴을 그대로 복제(스키마 칸 추가 + 설정 폼 + 저장 액션 + 회사별 조회). 새 구조를 만들지 않아 위험 최소.
  - 단위: 관리자 화면은 %(정수 30~90, 기본 50). 내부 판정은 ÷100 해서 0~1로 비교(기존과 동일).
  - .env LIVENESS_THRESHOLD는 회사 값이 없을 때의 예비값으로만 유지(하위 호환).
- **② 데모 AND 스위치**: DemoClient.tsx에 "평균 / 둘 다(AND)" 토글 추가. 유효점수 = 평균 모드는 (A+B)/2, AND 모드는 min(A,B) — "둘 다 기준 이상"과 min≥기준은 수학적으로 동일해서 이력 재계산이 한 줄로 됨. 서버·모델 코드 무수정.
- **③ 재동의 배너**: PHOTO_CONSENT_SINCE(2026-07-11)를 lib/clock-photo.ts로 옮겨 공유 → 얼굴인증 사용자 중 동의일이 그 이전인 사람에게 [내 출퇴근]·[인증방식] 화면에 배너 → /consent로 유도(재동의 시 동의시각만 갱신, 얼굴 등록 유지 — 철회 불필요).

## 2. 수정/생성 파일 목록
| 작업 | 파일 | 변경 |
|---|---|---|
| ① | webapp/prisma/schema.prisma | Company.livenessPercent Int @default(50) 추가 + 마이그레이션 |
| ① | webapp/app/actions/settings.ts | saveLivenessRule 액션 추가 |
| ① | webapp/app/settings/LivenessRuleForm.tsx | 신규(FaceRuleForm 복제) |
| ① | webapp/app/settings/page.tsx | 폼 배치 + select 필드 추가 |
| ① | webapp/app/actions/face.ts | livenessThreshold() → 회사 설정 조회로 교체(사용처 1곳) |
| ② | liveness-demo/app/DemoClient.tsx | 판정 방식 토글 + 유효점수 계산 |
| ② | D:\사진판독\... | 동일 파일 동기화 |
| ③ | webapp/lib/clock-photo.ts | PHOTO_CONSENT_SINCE 상수 이동(export) |
| ③ | webapp/app/actions/face.ts | 상수를 import로 교체 |
| ③ | webapp/app/attendance/page.tsx, app/auth-method/page.tsx | 재동의 배너 추가 |

## 3. 🛡️ 사이드 이펙트 방어
- 수정 금지 유지: lib/liveness.ts 전처리 상수 / clockIn·clockOut 본체 / 촬영 화질(1280·0.9) / FaceClockPanel 캡처.
- ①은 배지 계산만 변경(기본값 50 = 기존 0.5와 동일 → 마이그레이션 직후 동작 불변). ③은 화면 배너만(동의 로직 무수정). ②는 데모 전용.
- ⚠️ 스키마 변경 후 dev 서버 재시작 필수(옛 Prisma 클라이언트 이슈).
- 구현 후 회귀 테스트: 일반(GPS) 출퇴근 / 설정 화면 기존 폼 저장 / 관리자 근태상세 배지 / 내근태(직원에 판독 미노출) / tsc.

## 4. 작업분해 TODO
- [x] 1단계(①): 스키마+마이그레이션 → 조회·저장 액션 → 설정 폼 → face.ts 판정 교체 → 검증(80 저장 왕복 DB 확인·95 차단·50 복원) → 커밋 4d28307
- [x] 2단계(③): 상수 이동 → 배너 2곳 → 검증(홍길동 7/9 동의 계정에 배너 표시 → 재동의 E2E → 동의일 7/11 갱신·얼굴 유지·배너 소멸 확인 → 동의시각 7/9로 복원해 사장님 체험 보존) → 커밋 5940315
- [x] 3단계(②): 데모 토글 → 검증(3100 렌더·토글 상태 전환) → D:\사진판독 동기화 → 커밋 5e12111 ※동기화 직후 다른 세션이 D:에 "연속 촬영" 기능 추가(AND 토글은 유지됨) — 역동기화는 그 세션 몫으로 보류
- [x] 4단계: 회귀(관리자 근태상세 재검토 배지·출퇴근 화면·설정 기존 폼) + tsc 0 + 콘솔·서버 에러 0
- [x] 5단계: code-reviewer 검수(치명0·중간3·경미5) → 중간1(조회 실패 폴백)+경미5(적용 시점 안내) 수정 커밋 203708f → 상태 문서 갱신

## 5. 핵심 로직 샘플 (계획용)
```ts
// face.ts — 회사별 판정 기준(0~1). 회사 값 없으면 .env → 50% 순서로 예비.
async function getLivenessThreshold(companyId: string): Promise<number> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { livenessPercent: true } });
  if (c && Number.isFinite(c.livenessPercent)) return Math.min(90, Math.max(30, c.livenessPercent)) / 100;
  const v = Number(process.env.LIVENESS_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.5;
}
// DemoClient — 유효점수: AND 모드 = 두 모델 최소값(둘 다 기준 이상 ⟺ min ≥ 기준)
const effective = (a: number, b: number) => (mode === "and" ? Math.min(a, b) : (a + b) / 2);
```

## 6. 구현하지 않을 것
- AND 방식의 근태 반영 — 데모에서 사장님 비교 검증 후 별도 결정(오탐 증가 위험).
- 상용 라이브니스·모델 파인튜닝 / 감시성 기능(rPPG) / 3조각(실근무 확인) — 기존 보류 유지.
- 재동의 강제(차단) — 배너 안내만. 법적 가드(사진 미저장)는 이미 올바르게 동작 중.

## 📌 사용자 메모 공간
-
