// [단일 출처] 리포트 3형제(화면·엑셀·PDF)의 "그날이 결근인가 / 휴가인가" 판정.
//
// 왜 만들었나 (2026-08-03, 검수 H-7 후속):
//  · 결근 판정 규칙이 리포트 **화면에만** 있었다. 그래서 급여에 쓰는 **엑셀·근로기록부(PDF)에는
//    결근이 아예 없었고**, 한 달 내내 결근한 직원은 두 산출물에서 통째로 빠졌다.
//  · 세 곳에 같은 규칙을 복사하면 다음에 또 어긋난다 → 규칙을 여기 하나로 모으고 셋이 같이 쓴다.
//
// 규칙(리포트 화면이 쓰던 것 그대로):
//  · 근무예정일 = 근무요일 ∧ 쉬는날(공휴일·회사휴무일) 아님 ∧ (교대제면 그날 조 배정 ≠ 휴무)
//  · 결근 = 근무예정일 ∧ 출근기록 없음 ∧ 승인된 휴가일 아님 ∧ **승인된 출장·재택일 아님**
//    (출장·재택은 2026-11-21 사장님 결정으로 추가 — 관리자가 허가해 준 날이 법정 기록에 "결근"으로
//     찍히면 노무 분쟁에서 회사에 불리하다. 다만 **근무시간은 지어내지 않는다**: lib/away-server.ts 참고)
//  · 세는 구간 = [조회시작 ↔ 입사일 중 늦은 쪽, 상한(오늘/조회끝 중 이른 쪽) ↔ 퇴사일 중 이른 쪽)
//    (오늘과 퇴사일 당일은 세지 않는다 — 아직 근무 중일 수 있으므로)
import { toISODate } from "@/lib/period";
import { isEffectiveWorkDay } from "@/lib/workdays";
import { resolveShift, type ShiftContext } from "@/lib/shift";
import type { AwayKind } from "@/lib/away-server";

export type DayBreakdownInput = {
  start: Date; // 조회 시작(자정)
  absLimit: Date; // 세는 구간의 끝(미포함) — 보통 min(조회끝, 오늘 자정)
  workDays: Set<number>; // 그 직원의 실제 근무요일(회사 기본 또는 개인 예외)
  offDays: Set<string>; // 쉬는 날(공휴일 + 회사휴무일) ISO 집합
  shiftCtx: ShiftContext | null; // 교대제 회사면 컨텍스트, 비교대면 null(기존 경로)
  userId: string;
  shiftGroupId: string | null;
  attended: Set<string>; // 출근 기록이 있는 날(ISO)
  leaveDays: Set<string>; // 승인된 휴가일(ISO) — 조퇴는 제외됨(lib/leave.ts leaveDateSet)
  /** 승인된 출장·재택일(ISO → 종류). 이 날은 결근이 아니라 '출장'/'재택' 줄로 남는다.
   *  ⚠️ 호출부가 반드시 넘긴다(선택 인자로 두면 빠뜨린 화면만 조용히 옛 기준이 되어 숫자가 어긋난다). */
  awayDays: Map<string, AwayKind>;
  hireDate: Date | null;
  deactivatedAt: Date | null;
};

// 그 직원의 기간을 하루씩 훑어 "결근한 날"과 "휴가로 쉰 날"을 각각 돌려준다.
//  · onLeave = 근무예정일인데 출근 없이 승인 휴가로 쉰 날(엑셀·PDF에 '휴가' 줄로 남긴다)
//  · 반차처럼 출근도 한 날은 출근 기록이 있으므로 onLeave에 넣지 않는다(같은 날 줄이 두 개가 되는 것을 막는다).
//    다만 **휴가 일수 집계**에는 그 날도 들어가야 하므로(오전 반차 쓰고 출근한 날 = 0.5일 소진)
//    leaveAll에 따로 모은다 — 줄(rows)과 집계(일수)의 기준이 다르다는 점을 헷갈리지 말 것.
export function dayBreakdown(i: DayBreakdownInput): {
  absent: string[];
  onLeave: string[];
  leaveAll: string[];
  /** 승인된 출장·재택인데 출퇴근 기록이 없는 근무예정일 — 결근이 아니라 '출장'/'재택' 줄로 남긴다. */
  away: { date: string; kind: AwayKind }[];
} {
  const absent: string[] = [];
  const onLeave: string[] = [];
  const leaveAll: string[] = [];
  const away: { date: string; kind: AwayKind }[] = [];

  let from = new Date(i.start);
  if (i.hireDate) {
    const hire = new Date(i.hireDate.getFullYear(), i.hireDate.getMonth(), i.hireDate.getDate());
    if (hire > from) from = hire;
  }
  let to = new Date(i.absLimit);
  if (i.deactivatedAt) {
    const left = new Date(i.deactivatedAt.getFullYear(), i.deactivatedAt.getMonth(), i.deactivatedAt.getDate());
    if (left < to) to = left; // 퇴사일 당일은 세지 않는다(그날은 근무했을 수 있어 기록으로 판단)
  }

  for (let cur = new Date(from); cur < to; cur = new Date(cur.getTime() + 86400000)) {
    const iso = toISODate(cur);
    const isWork =
      isEffectiveWorkDay(cur, i.workDays, i.offDays) &&
      (!i.shiftCtx || resolveShift(i.shiftCtx, i.userId, i.shiftGroupId, iso) !== null);
    if (!isWork) continue;
    if (i.leaveDays.has(iso)) leaveAll.push(iso); // 출근 여부와 무관한 "휴가를 쓴 근무예정일"
    if (i.attended.has(iso)) continue;
    // 우선순위: 휴가 > 출장·재택 > 결근.
    //  휴가를 앞에 두는 이유 — 휴가는 **연차가 이미 차감된** 확정 사실이라, 같은 날 출장 승인이 겹쳐도
    //  휴가로 남아야 차감 내역과 기록이 맞는다.
    if (i.leaveDays.has(iso)) {
      onLeave.push(iso);
      continue;
    }
    const kind = i.awayDays.get(iso);
    if (kind) away.push({ date: iso, kind });
    else absent.push(iso);
  }
  return { absent, onLeave, leaveAll, away };
}

// 결근 일수만 필요할 때(리포트 화면).
export function absentCount(i: DayBreakdownInput): number {
  return dayBreakdown(i).absent.length;
}
