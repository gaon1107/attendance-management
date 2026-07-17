# Plan: A-1 생체정보 파기 시 GaonFR 원본삭제 배선 (2026-07-17) — 상태: ✅ 코드완료(커밋 b832b0a), 사장님 실검증만 대기

## 1. 접근 방식 (+이유)
`webapp/app/actions/authmethod.ts`의 파기 3함수(chooseGps·withdrawBiometric·adminRevokeBiometric)를
**이미 검증된 `deleteMyFace` 패턴 그대로** 미러링해 GaonFR 얼굴 삭제를 연결한다.
- 이유: 신규 방식을 만들지 않고 **동일 저장소에 이미 있는 정답 패턴**을 재사용 → 위험 최소·리뷰 쉬움.
- 새 표·새 라이브러리·스키마 변경 **없음**(값만 변경) → 마이그레이션·서버 재시작 불필요.

## 2. 수정/생성 파일 목록
- **수정 1개**: `webapp/app/actions/authmethod.ts`
  - (신규 헬퍼) `unenrollFaceSafely(userId, companyId, wasEnrolled): Promise<boolean>` — 이 파일 안에서만 사용.
  - `chooseGps` / `withdrawBiometric` / `adminRevokeBiometric` 각각 배선 3줄 수준 추가.
  - import에 `unenrollFace` 추가(`@/lib/face`).
- **무수정**: lib/face.ts, lib/audit.ts, lib/clock-photo.ts, prisma/schema.prisma(=마이그레이션 없음).

## 3. 🛡️ 사이드 이펙트 방어
- **영향받는 화면(faceEnrolledAt/faceEnrollCount을 null/0로 변경)**: auth-method·attendance·face-enroll 페이지 — 전부 읽기전용 표시/게이팅. 파기 후 "미등록"으로 보이는 게 정상(현재의 유령 "등록됨" 표시 버그도 함께 해소). **깨지는 로직 없음.**
- **본기능 무차단 원칙 유지**: GaonFR 삭제가 실패/지연돼도 DB 파기·로컬 사진 파기·redirect는 정상 완료. 감사로그 result만 "fail"로 정직하게 기록(audit.ts 원칙 ④). → `unenrollFaceSafely`는 try/catch로 감싸 예외를 삼키고 bool만 반환(`purgePhotosSafely`와 동일 방어).
- **회사 격리 유지**: adminRevoke의 기존 `companyId` 검사·`hadBiometric` 조기반환 그대로. unenroll은 검사 통과 뒤에만.
- **구현 후 반드시 테스트할 기존 기능**:
  1. 일반(얼굴 무관) GPS 직원의 chooseGps → 오류 없이 GPS 전환(unenroll 미호출)
  2. 얼굴 등록 직원 withdraw → DB 파기 + GaonFR 삭제 + 감사로그
  3. 관리자 adminRevoke → 대상 직원 GaonFR 삭제 + 감사로그(대상명 포함)
  4. deleteMyFace(내 얼굴삭제, 무수정) 회귀 없음
  5. 재동의(agreeBiometric) 후 화면이 "미등록"에서 정상 시작(유령표시 해소 확인)

## 4. 작업분해 TODO
- [x] 1단계: `authmethod.ts` import에 `unenrollFace` 추가 + 헬퍼 `unenrollFaceSafely` 작성
- [x] 2단계: `chooseGps` 배선
- [x] 3단계: `withdrawBiometric` 동일 배선
- [x] 4단계: `adminRevokeBiometric` 동일 배선(target 기준)
- [x] 5단계: tsc + eslint 0 확인 (통과)
- [x] 7단계: code-reviewer 검수 2회 → 중간2·경미2 반영(타임아웃 call-site / unenroll 먼저→성공시만 표시해제 / adminRevoke 고아상태 게이트 / clearTimeout). 재검토 치명0·회귀0.
- [x] 8단계: git 커밋(b832b0a) + project-status.md·백로그 갱신
- [ ] 6단계: **얼굴서버 실검증(사장님 환경)** — 등록→철회/파기→GaonFR 실제 삭제·감사로그 result 확인. (남은 것은 이것뿐)

## 5. 핵심 로직 샘플 (계획용 스니펫, 실제 구현 아님)
```ts
import { unenrollFace } from "@/lib/face";

// GaonFR에 등록된 얼굴 원본을 삭제한다. 등록이 없으면 지울 것도 없어 성공으로 본다.
// 삭제 실패가 파기(철회) 자체를 막지 않도록 예외를 삼키고 결과(bool)만 알린다(purgePhotosSafely와 동일 방어).
// 반환값 = "얼굴서버에 남은 얼굴이 없음이 보장되는가".
async function unenrollFaceSafely(userId: string, companyId: string, wasEnrolled: boolean): Promise<boolean> {
  if (!wasEnrolled) return true; // 등록된 얼굴이 없으면 지울 것도 없음
  try {
    const r = await unenrollFace(userId, companyId); // FaceId=직원 id, Group=회사 id
    if (!r.success) console.error("[authmethod] 얼굴서버 원본 삭제 실패(파기는 정상 처리됨):", r.message);
    return r.success;
  } catch (e) {
    console.error("[authmethod] 얼굴서버 원본 삭제 오류(파기는 정상 처리됨):", e);
    return false;
  }
}

// 예: withdrawBiometric
const had = hadBiometric(me);
const wasEnrolled = me.faceEnrolledAt !== null;           // update 전에 캡처
await prisma.user.update({
  where: { id: me.id },
  data: { authMethod: "gps", faceConsentAt: null, faceEnrolledAt: null, faceEnrollCount: 0 }, // 등록표시까지 정리
});
const purged = await purgePhotosSafely(me.id);
const unenrolled = await unenrollFaceSafely(me.id, me.companyId, wasEnrolled);
if (had) await logAdminAction(me, "purge", "self_withdraw", (purged && unenrolled) ? "success" : "fail");
```
※ chooseGps=target "switch_to_gps", adminRevoke=`me`→`target` 치환·대상명 로그 유지.

## 6. 구현하지 않을 것 (범위 제외 + 이유)
- **unenrollFace 타임아웃 추가(face.ts)**: 공통모듈 수정·deleteMyFace 동반 영향 → 별도 승인 사안. 기본 제외(기존 위험 유지, 아래 메모에서 선택 가능).
- **GaonFR 삭제 실패 자동 재시도 큐**: 백로그 사안(지금은 result=fail 기록 + 재파기로 대응).
- 직원관리 감사로그 확장, 알림센터 통합(C-2) 등 다른 백로그 항목.

## 📌 사용자 메모 공간 (검토 후 여기에 적어주세요)
- (선택) unenrollFace에 10초 타임아웃도 같이 넣을까요? → 넣기 / 안 넣기:
-
