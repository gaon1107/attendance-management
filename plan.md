# Plan: C-1 사번(employeeNo) 회사내 중복검사 (2026-07-18) — 상태: 검토 대기

## 1. 접근 방식 (+이유)
**접근 A — 앱단 중복검사**를 채택한다. 저장 직전에 "같은 회사에 같은 사번을 가진 다른 활성 직원이 있나"를 DB로 확인해, 있으면 저장을 막고 친절한 에러를 돌려준다.
- 이유: ①기존 email 중복검사(acceptInvite)와 **똑같은 방식**이라 코드 일관 ②**스키마 무변경 → 마이그레이션·서버끄기 없음**(EPERM 무관) ③범위 작고 회귀 위험 낮음.
- DB 유니크 제약(접근 B)은 마이그레이션·기존중복데이터·원시에러 처리가 필요해 이번 범위에서 제외(추후 방어층으로 별도 결정).

## 2. 수정/생성 파일 목록
- **lib/employee-profile.ts** — 신규 헬퍼 `employeeNoTaken()` **추가만**(기존 `parseProfile` 무수정). prisma import 추가.
- **app/actions/employees.ts** `updateEmployeeProfile` — 저장 전 중복검사 1블록 추가(본인 제외).
- **app/actions/invites.ts** `acceptInvite` — email 검사 뒤에 사번 중복검사 1블록 추가.
- **무변경**: prisma/schema.prisma(마이그레이션 없음), 표시 화면들(page/ProfileForm/InviteForm — 에러는 기존 {error} 표시 경로 그대로 씀).

## 3. 🛡️ 사이드 이펙트 방어
- **`parseProfile` 무수정** → 전화·직급·입사일 등 다른 인적정보 저장 회귀 없음.
- **회사격리 유지**: 검사 쿼리에 `companyId` 항상 포함(다른 회사 사번과는 안 부딪힘).
- **본인 제외**: 관리자 수정 시 `exceptUserId=target.id` → 자기 사번 그대로 두고 다른 항목만 고쳐도 "중복" 오탐 안 남.
- **미입력(null) 허용**: employeeNo가 null이면 검사 자체를 건너뜀 → 사번 안 쓰는 회사·직원 영향 0.
- **퇴사자 제외**: `deactivatedAt: null`인 활성 직원만 검사 → 퇴사자 사번 재사용 가능(과거 기록은 그대로 보존).
- **구현 후 반드시 테스트할 기존 기능**:
  1. 사번 없이 저장(관리자 수정/초대가입) → 정상(검사 통과)
  2. 서로 다른 사번 2명 저장 → 정상
  3. 같은 사번 2번째 저장 시도 → **막히고 에러 메시지** 표시
  4. 관리자가 본인 사번 그대로 두고 전화번호만 수정 → 정상(자기충돌 아님)
  5. 다른 회사에 같은 사번 존재 → 영향 없음(저장됨)
  6. 전화·직급·입사일 정상 저장 회귀 없음

## 4. 작업분해 TODO
- [ ] 1단계: `lib/employee-profile.ts`에 `employeeNoTaken(companyId, employeeNo, exceptUserId?)` 헬퍼 추가
- [ ] 2단계: `updateEmployeeProfile`에 중복검사 블록 추가(본인 제외)
- [ ] 3단계: `acceptInvite`에 중복검사 블록 추가(email 검사 뒤)
- [ ] 4단계: tsc + eslint 0 확인
- [ ] 5단계: 위 6종 시나리오 실검증(가능한 것은 DB/실화면)
- [ ] 6단계: code-reviewer 검수 + 치명·중간 반영
- [ ] 7단계: git 커밋 + project-status.md·백로그 갱신

## 5. 핵심 로직 샘플 (계획용 스니펫, 실제 구현 아님)
```ts
// lib/employee-profile.ts (추가)
import { prisma } from "@/lib/db";
// 같은 회사에 같은 사번을 쓰는 "다른 활성 직원"이 있는지. employeeNo=null이면 검사 안 함(항상 false).
export async function employeeNoTaken(companyId: string, employeeNo: string | null, exceptUserId?: string): Promise<boolean> {
  if (!employeeNo) return false; // 미입력은 중복검사 대상 아님
  const dup = await prisma.user.findFirst({
    where: {
      companyId,
      employeeNo,
      deactivatedAt: null,                 // 퇴사자 제외(재사용 허용)
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}), // 본인 제외
    },
    select: { id: true },
  });
  return !!dup;
}

// updateEmployeeProfile — parseProfile 뒤, update 앞
if (await employeeNoTaken(me.companyId, parsed.profile.employeeNo, target.id)) {
  return { error: "이미 같은 사번을 쓰는 직원이 있습니다. 다른 사번을 입력해 주세요." };
}

// acceptInvite — email 중복검사 뒤, create 앞
if (await employeeNoTaken(invite.companyId, parsed.profile.employeeNo)) {
  return { error: "이미 같은 사번을 쓰는 직원이 있습니다. 관리자에게 확인해 주세요." };
}
```

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- **DB 유니크 제약(@@unique)**: 마이그레이션·서버끄기·기존중복데이터 처리 필요 → 추후 별도 결정(동시제출 완벽차단이 필요해질 때).
- **기존 데이터의 이미 중복된 사번 정리**: 지금 중복이 있다면 저장 시점부터 막을 뿐, 과거분 자동정리는 안 함(보고만).
- **대소문자 정규화·사번 형식 규칙**: 범위 밖(지금은 trim만).

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- 퇴사자 사번 재사용 허용(활성자만 검사)이 맞나요? → 예 / 아니오:
-
