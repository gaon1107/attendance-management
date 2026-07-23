# Plan: B-6 외출 사유 회사별 편집 — 2026-07-23 — 상태: 검토 대기

> 목표: 직원 [출퇴근] 화면의 외출 사유 드롭다운(현재 "식사·외근·개인용무·기타" 고정)을 **회사가 [설정]에서 직접 편집**할 수 있게 한다. 설정 안 한 회사는 **지금과 100% 동일**하게 동작.

## 1. 접근 방식 (+이유)

**회사 설정에 "외출 사유" 칸을 추가하고, 비어 있으면 기존 4종을 쓴다.**

- 저장 형식 = **쉼표로 구분한 한 줄 문자열**(예: `식사, 외근, 개인용무, 기타`). 이미 `officeIps`(허용 IP)·`workDays`(근무요일)가 같은 방식이라 관례 일치 + 표를 새로 만들 필요 없음 = 가장 작은 변경.
- 목록 해석 규칙(빈값→기본 4종, 공백 제거, 중복 제거, 최대 개수)은 **`lib/outing-reasons.ts` 순수함수 하나**로 모아 화면·서버 양쪽이 같은 걸 쓰게 한다(규칙이 두 군데로 갈라지는 사고 방지).

## 2. 수정/생성 파일 목록

**생성 2개**
- `webapp/lib/outing-reasons.ts` — 기본값 상수 + `parseOutingReasons(raw)` 순수함수 (단일 출처)
- `webapp/app/settings/OutingReasonForm.tsx` — 설정 화면 카드(입력·저장·미리보기)

**수정 5개**
- `webapp/prisma/schema.prisma` — `Company.outingReasons String?` **1칸 add-only** (+ 마이그레이션 1개)
- `webapp/app/actions/settings.ts` — `saveOutingReasons` 서버액션 **추가**(기존 액션 무수정)
- `webapp/app/settings/page.tsx` — 카드 1개 배치(기존 카드 무수정)
- `webapp/app/attendance/page.tsx` — 하드코딩 `REASONS` 제거 → 회사 설정에서 읽어 드롭다운 구성
- `webapp/app/actions/attendance.ts` — `startBreak`가 **목록에 있는 사유인지 검증**(폼 위조 차단)

## 3. 🛡️ 사이드 이펙트 방어

- **과거 외출 기록**: 저장된 사유 문자열은 그대로 둔다(이력 보존). 목록에서 지운 사유도 옛 기록엔 그대로 표시 → 근태상세·통계 무영향. *(research: 사유로 분기하는 로직이 코드 전체에 0곳)*
- **근무시간 계산**([lib/worktime.ts](webapp/lib/worktime.ts)): **손대지 않는다.** 외출 시간 차감 규칙 그대로.
- **설정 안 한 기존 회사**: DB 값 `null` → 기본 4종 폴백 → **현재와 화면·동작 동일**(회귀 0).
- **다른 설정 카드**(근무규칙·사내네트워크·얼굴·공휴일 등): 파일을 건드리지 않고 `settings/page.tsx`에 **추가만** 한다.
- **외출/외근 결재 신청**(`OutingRequest`·approvals): **완전 무접촉.**
- **구현 후 반드시 테스트할 기존 기능**:
  1. 설정 안 한 회사 → 외출 드롭다운에 기존 4종 그대로
  2. 외출 → 복귀 → 근무시간에서 외출시간 차감되는지(기존 계산)
  3. 근태상세(직원별 상세)에 외출 사유 표시
  4. 대시보드 "외출 중" 인원 수
  5. 리포트·엑셀의 외출(회) 숫자
  6. [설정] 화면의 다른 카드들 정상

## 4. 작업분해 TODO
- [ ] 1단계: `lib/outing-reasons.ts` 순수함수 + 기본값 상수
- [ ] 2단계: 스키마 `Company.outingReasons` 추가 + 마이그레이션(서버 끄고 실행)
- [ ] 3단계: `saveOutingReasons` 서버액션(관리자만·검증)
- [ ] 4단계: `OutingReasonForm` + 설정 화면 배치
- [ ] 5단계: `attendance/page.tsx` 드롭다운 배선 + `startBreak` 검증
- [ ] 6단계: 임시 라우트로 순수함수·저장 라운드트립 검증 → **라우트 삭제**
- [ ] 7단계: 3001 실화면 검증(위 6개 항목)
- [ ] 8단계: code-reviewer 검수 → 커밋 → project-status.md 갱신

## 5. 핵심 로직 샘플 (계획용 — 실제 구현 아님)
```ts
// lib/outing-reasons.ts
export const DEFAULT_OUTING_REASONS = ["식사", "외근", "개인용무", "기타"];
export const MAX_OUTING_REASONS = 10;
export const MAX_REASON_LEN = 20;

/** 회사 설정 문자열 → 사유 목록. 비었거나 전부 걸러지면 기본 4종. */
export function parseOutingReasons(raw: string | null | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.length <= MAX_REASON_LEN);
  const uniq = [...new Set(list)].slice(0, MAX_OUTING_REASONS);
  return uniq.length > 0 ? uniq : DEFAULT_OUTING_REASONS;
}
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- **사유별 근무시간 차감 구분**("외근은 근무로 인정" 등) — 근무시간 계산 규칙 변경은 별개의 큰 결정. *(연차·리포트·법정기록에 전부 파급)*
- **외출/외근 결재 신청(OutingRequest)의 자유입력 사유** — 다른 기능.
- **휴게시간 회사별 설정화면**(백로그 별건) · **사유별 통계 화면** — 이번 범위 아님.
- 과거 기록의 사유 일괄 변경(마이그레이션) — 이력은 보존이 원칙.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
