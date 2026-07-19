# Research: Shift 삭제 시 fixed 측(ShiftPattern·ShiftAssignment) dangling 참조 정리 (2026-07-20)

## 관련 파일과 역할
- `webapp/app/actions/settings.ts` — `saveWorkRules`: 근무제 저장. **작업 대상.**
  - master 기준 이미 단일 `$transaction`으로 원자화됨(커밋 a9c2e8a).
  - 교대 수 축소(3→2) 시 `tx.shift.deleteMany({ order: { gt: shiftMode } })`로 초과 Shift 행 삭제.
  - 완전 OFF(shiftMode=null) 시엔 `if(shiftMode)` 블록을 건너뛰어 **Shift 행을 의도적으로 남긴다**(휴면).
- `webapp/prisma/schema.prisma`
  - `Shift`(501): `@@unique([companyId, order])`, order는 1-based(1,2,3).
  - `ShiftPattern`(513): `shiftId String?` — **Shift로의 @relation(FK) 없음.** fixed 요일패턴.
  - `ShiftAssignment`(543): `shiftId String?` — **FK 없음.** 날짜 예외(fixed·rotation 공통 덮어쓰기 층).
  - `ShiftGroup`(524): 순환 조. a9c2e8a에서 이미 정리됨.
- `webapp/lib/shift.ts` — `resolveShift`: `sid ? ctx.shiftById.get(sid) ?? null : null` → dangling id는 조회 실패 → null(휴무). **크래시 없음.**
- `webapp/lib/shift-server.ts` — `loadShiftContext`: ShiftPattern·ShiftAssignment를 읽어 `patternByUserDow`/`assignmentByUserDate` 맵 구성(shiftId 그대로 보관).
- `webapp/app/shifts/page.tsx`(93) — `if (p.shiftId) patMap[...] = p.shiftId`: 고정 패턴 그리드가 shiftId를 셀 선택값으로 표시. dangling이면 없는 조를 가리켜 드롭다운이 빈칸으로 보임.

## 🔴 영향 범위 (수정 대상을 사용하는 모든 곳)
- `ShiftPattern.shiftId` 읽는 곳: `shift-server.ts`(loadShiftContext), `shifts/page.tsx`(패턴 그리드). 쓰는 곳: `shift.ts` `saveFixedPattern`(유효 shiftId만 저장, 무효면 null).
- `ShiftAssignment.shiftId` 읽는 곳: `shift-server.ts`(loadShiftContext)만. **쓰는 곳(upsert/create) 없음** — 날짜 예외 저장 기능은 아직 미구현(스키마·읽기만 존재). 향후 대비·방어 목적.
- `worktime.ts`: shiftId 참조 없음. 무관.

## 공통 모듈 여부 / 건드리면 안 되는 부분
- 수정 지점은 `saveWorkRules` 내부 트랜잭션 한 곳(개별 함수). 다른 곳에서 호출되는 공통 함수 아님.
- `resolveShift`의 null-안전 로직은 그대로 둔다(방어선 유지).

## DB·API 변경 여부, 위험 요소
- **DB 스키마 변경 없음**(FK 추가 아님 — 마이그레이션 불필요). 데이터 정리만.
- 트랜잭션: 이미 있는 단일 `$transaction` 안에 정리 구문을 추가 → 원자성 유지, 부분커밋 없음.
- companyId 스코프 필수(테넌트 격리). `updateMany`/`findMany` 모두 companyId 조건 포함.
- 동시성: 트랜잭션 내 순차 실행이라 안전. N+1 없음(id 목록 1회 조회 후 IN 절 일괄 처리).

## 결론 (계획 시 고려사항)
1. dangling은 **교대 수 축소(3→2)로 Shift가 실제 삭제될 때만** 발생. OFF(null) 시엔 Shift를 남기므로 dangling 없음 → 정리 불필요(요청의 "OFF 시" 가설에 대한 답).
2. 따라서 정리는 `if(shiftMode)` 블록 안, `shift.deleteMany` 지점에만 추가한다.
3. ShiftPattern/ShiftAssignment는 order를 저장하지 않고 shiftId만 저장 → **삭제 대상 Shift의 id를 먼저 조회**한 뒤 그 id로 참조를 null 처리해야 함(ShiftGroup 정리와 동일 패턴: 참조 해제 → 삭제).
4. 비교대 회사(shiftMode=null)는 블록 미진입 → 무영향(회귀 0).
