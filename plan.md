# Plan: Shift 삭제 시 fixed 측(ShiftPattern·ShiftAssignment) dangling 참조 정리 (2026-07-20) — 상태: 검토 대기

## 1. 접근 방식 (+이유)
- 커밋 a9c2e8a가 **순환 측**(ShiftGroup·배정·orderCsv)만 정리해 비대칭이 남았다. 같은 철학을 **fixed 측**에 대칭 적용한다:
  **참조 해제(null) → 삭제** (ShiftGroup에서 "user.shiftGroupId=null → group 삭제"와 동일 순서).
- 위치: `saveWorkRules`의 **기존 단일 `$transaction` 안**, `if(shiftMode)` 블록의 `shift.deleteMany` 지점.
  → 이미 원자화된 트랜잭션에 얹으므로 부분커밋 위험 없음, companyId 스코프 유지.
- **OFF(shiftMode=null) 시엔 추가 정리 안 함**: 그 경우 Shift 행을 의도적으로 남기므로(휴면) dangling이 생기지 않는다.
  요청의 "OFF 시" 가설을 검토한 결과 = 불필요. (근거: research.md 결론 1)

## 2. 수정/생성 파일 목록
- 수정: `webapp/app/actions/settings.ts` (메인 저장소 master, `saveWorkRules` 1곳)
- 생성: 없음 (스키마·마이그레이션 변경 없음)

## 3. 🛡️ 사이드 이펙트 방어
- **영향받을 수 있는 기능 + 대응**
  - 고정(fixed) 회사 요일패턴: 삭제된 조를 가리키던 셀이 null(휴무)로 바뀜 → 원래 그 조가 사라졌으니 **정상·의도된 결과**. `shifts/page.tsx` 그리드도 빈칸 대신 명시적 휴무로 깔끔해짐.
  - 순환(rotation) 회사: ShiftGroup은 a9c2e8a가 이미 처리. 추가되는 ShiftAssignment(날짜 예외) 정리는 삭제된 조를 가리키던 예외만 null → 정상.
  - 비교대 회사(shiftMode=null): `if(shiftMode)` 미진입 → 새 코드 실행 안 됨 → **완전 무영향**.
- **구현 후 반드시 테스트할 기존 기능 목록**
  1. 비교대 회사 근무제 저장(교대 미사용) — 오류·회귀 없는지
  2. 고정 3교대 → 2교대 축소 저장 후 3조 참조 패턴이 null 되는지 / 1·2조 패턴 보존되는지
  3. 고정 2교대 → 2교대(동일 수) 저장 시 패턴 보존(불필요 삭제 없음)
  4. 교대 완전 OFF 저장 시 Shift·패턴 그대로 남는지(휴면, 파괴 없음)
  5. `tsc`·`eslint` 0

## 4. 작업분해 TODO
- [ ] 1단계: `saveWorkRules` 트랜잭션 내 `shift.deleteMany`를 "삭제 대상 id 조회 → ShiftPattern/ShiftAssignment.shiftId null 처리 → 해당 id 삭제"로 교체 — 파일: `webapp/app/actions/settings.ts`
- [ ] 2단계: `tsc` + `eslint` 통과 확인
- [ ] 3단계: 저장 로직 롤백 검증(실DB 무커밋) — 위 3.테스트 1~4 시나리오
- [ ] 4단계: 영향받는 기존 기능 회귀 테스트(비교대·고정)
- [ ] 5단계: 검수(code-reviewer 서브에이전트) + project-status.md 갱신 + git 커밋

## 5. 핵심 로직 샘플 (계획용 스니펫, 실제 구현 아님)
```ts
// 기존:
//   await tx.shift.deleteMany({ where: { companyId: me.companyId, order: { gt: shiftMode } } });
// 교체:
const staleShifts = await tx.shift.findMany({
  where: { companyId: me.companyId, order: { gt: shiftMode } },
  select: { id: true },
});
if (staleShifts.length) {
  const staleIds = staleShifts.map((s) => s.id);
  // FK 없는 참조(fixed 요일패턴·날짜 예외)를 휴무(null)로 먼저 끊는다 — 순환 ShiftGroup 정리와 동일 철학.
  await tx.shiftPattern.updateMany({
    where: { companyId: me.companyId, shiftId: { in: staleIds } },
    data: { shiftId: null },
  });
  await tx.shiftAssignment.updateMany({
    where: { companyId: me.companyId, shiftId: { in: staleIds } },
    data: { shiftId: null },
  });
  await tx.shift.deleteMany({ where: { id: { in: staleIds } } });
}
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- schema.prisma에 FK(@relation) 추가 / 마이그레이션 — 요청 범위 밖(데이터 정리만). 구조 변경은 별도 검토 조각.
- OFF 시 Shift 행 삭제 — 현행 설계(휴면 후 재활성화)를 바꾸지 않는다.
- `resolveShift` 등 읽기 측 로직 — null-안전 방어선은 그대로 둔다.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
-
