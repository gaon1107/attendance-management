// [무료 체험 기간] 회사가 가입한 날부터 30일. 단, 운영자가 회사별로 마지막 날을 지정했으면(Company.trialLastDate) 그 날까지.
//
// ※ 2026-11-18(운영 준비 3단계): 첫 고객 3개월 무료처럼 회사마다 다르게 주려고 "마지막 날" 칸을 더했다.
//    시작 칸을 새로 만든 것이 아니다 — 시작은 여전히 createdAt 하나다(아래 원칙 그대로).
//
// ⚠️ **체험 시작 시각을 위한 새 칸을 만들지 않는다.** 이미 `Company.createdAt`이 가입 시각이고,
//    그것이 곧 체험 시작이다(사장님 확정 2026-08-09). 칸을 하나 더 두면 두 값이 어긋날 때
//    "어느 쪽이 진짜 시작일인가"를 가릴 방법이 없어진다.
//
// ⚠️ **이 파일은 아무것도 막지 않는다.** 지금은 대시보드에 남은 기간을 보여주는 용도뿐이다.
//    만료 시 차단은 **결제 화면과 한 세트로** 만들기로 했다(사장님 확정 2026-08-09) —
//    결제 수단이 없는 상태에서 막으면 고객이 **돈을 낼 방법도 없이** 회사 근태가 통째로 멈춘다.
//
//    ▶ 그때 적용할 차단 범위 (사장님 확정 2026-08-09): **직원의 출퇴근 기능만 막는다.**
//      · 막을 것 : 직원의 출근·퇴근·외출·복귀 기록 (app/actions/attendance.ts의 네 창구)
//      · 막지 않을 것 : 관리자의 모든 기능, 그리고 직원의 휴가·정정 등 신청과 조회.
//        특히 **이미 쌓인 근로기록의 조회·엑셀 내보내기는 반드시 열어 둔다** — 근로기록 3년 보존은
//        사업주의 법적 의무라, 그걸 못 꺼내게 막으면 책임이 우리 쪽으로 온다.
//      · 얼굴·GPS 출퇴근(app/actions/face.ts)도 같은 "출퇴근 기록"이므로 함께 막아야 한다.
//        웹 버튼만 막고 얼굴 출퇴근을 열어 두면 차단이 뚫린다.
//
// 순수함수로 둔 이유: 이 프로젝트는 테스트 러너가 없어 임시 라우트로 검증한다(webapp/CLAUDE.md).
// 화면에서 날짜를 계산하면 그 검증이 불가능하다.

/** 무료 체험 일수. 홈화면 요금제 문구("30일 동안 먼저 써 보세요")와 **같은 값이어야 한다**. */
export const TRIAL_DAYS = 30;

/** 그 날의 자정(00:00). 서버 TZ=Asia/Seoul 전제(webapp/CLAUDE.md). */
function midnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialStatus = {
  /** 이 시각(자정)이 되면 만료다. 즉 체험 마지막 날은 이 하루 전이다. */
  endsAt: Date;
  /** 오늘 포함 남은 일수. 가입 당일이면 TRIAL_DAYS, 만료됐으면 0 이하. */
  daysLeft: number;
  expired: boolean;
};

/**
 * 가입 시각으로 체험 상태를 계산한다.
 *  · **시·분이 아니라 날짜로 센다.** 오전 9시에 가입한 회사가 오후 6시에 "29일 남음"으로 바뀌면
 *    고객은 하루를 손해 봤다고 느낀다. 자정 기준이라 하루 종일 같은 숫자가 보인다.
 *  · 한국은 서머타임이 없어 자정끼리의 밀리초 뺄셈이 항상 하루의 배수다(Math.round는 부동소수 방어).
 *  · lastDate(운영자 지정 마지막 날)가 있으면 **그 날까지 무료** → 만료 자정은 그 다음 날 0시.
 *    없으면(null·생략) 기존과 완전히 같게 가입일 + TRIAL_DAYS.
 */
export function trialStatus(signedUpAt: Date, now: Date = new Date(), lastDate?: Date | null): TrialStatus {
  const endsAt = lastDate
    ? new Date(midnight(lastDate).getTime() + DAY_MS)
    : new Date(midnight(signedUpAt).getTime() + TRIAL_DAYS * DAY_MS);
  const daysLeft = Math.round((endsAt.getTime() - midnight(now).getTime()) / DAY_MS);
  return { endsAt, daysLeft, expired: daysLeft <= 0 };
}

/** 체험 마지막 날(사람에게 보여줄 날짜). endsAt은 "만료되는 자정"이라 하루를 빼야 한다. */
export function trialLastDay(endsAt: Date): Date {
  return new Date(endsAt.getTime() - DAY_MS);
}

/** "2026년 8월 21일" — 화면 표시용. */
export function formatKoreanDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
