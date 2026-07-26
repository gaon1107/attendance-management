// PC-OFF 정책 조립 — 설치된 PC 에이전트가 "지금 잠가야 하나"를 판단하는 데 필요한 재료를 한 번에 내려준다.
//  · ⚠️ 이 파일은 기존 데이터를 **읽기만** 한다. 근무시간·휴일·승인된 연장근무를 새로 만들거나 고치지 않는다.
//  · 왜 서버가 시각을 함께 주나(serverTime): 직원이 PC 시계를 돌려 잠금을 피하는 것을 막기 위해서다.
//    앱은 "내 PC 시계"가 아니라 "서버 시각과의 차이"를 기준으로 판단한다.
//  · 왜 오늘+내일 두 날인가: 자정을 넘기는 야근(예: 22:00~익일 02:00)과 다음 근무일 자동 해제를 앱이 계산해야 하기 때문.
//  · ⚠️ 이 파일은 **서버 전용**(prisma·holiday-server import). 브라우저에서 쓰는 규칙은 lib/pcoff.ts(순수)에 있다.
import { prisma } from "./db";
import { loadOffDays } from "./holiday-server";
import { effectiveWorkDays, daysToCsv } from "./workdays";
import { toISODate } from "./period";
import { parseNotifyMins, parseTempReasons } from "./pcoff";

// 정책 응답(앱이 받는 JSON) — 여기에 없는 항목은 앱이 알 수 없다(수집·전달 범위를 이 타입이 못박는다).
export type PcOffPolicy = {
  serverTime: string;        // 서버 현재 시각(ISO). 앱은 이걸 기준으로 시계 오차를 보정한다.
  enabled: boolean;          // 이 직원 PC를 잠금 대상으로 볼지. false면 앱은 완전히 쉰다.
  // enabled=false인 이유(표시·디버깅용)
  //  "company_off"(회사가 끔) | "user_exempt"(예외자) | "no_worktime"(퇴근 기준시각 미설정)
  //  | "shift_unsupported"(교대근무 회사 — 1차 미지원) | "unknown"(데이터 없음, 있을 수 없는 상태)
  disabledReason?: string;
  mode: string;              // "lock"(화면 잠금)
  delayMin: number;          // 퇴근 기준시각 이후 유예(분)
  notifyMins: number[];      // 잠금 전 미리 알림 시점(분 전)
  tempUse: {
    minutes: number;         // 1회 길이(분)
    perDay: number;          // 하루 허용 횟수
    usedToday: number;       // 오늘 이미 쓴 횟수(서버가 센다 — 앱을 다시 깔아도 초기화되지 않는다)
    reasons: string[];       // 잠금화면에서 고를 사유 목록. ⚠️ 앱은 자유입력을 주지 않는다(민감정보 유입 차단).
  };
  work: {
    startTime: string | null; // "HH:MM" 회사 표준 출근 기준시각
    endTime: string | null;   // "HH:MM" 회사 표준 퇴근 기준시각 — 잠금 기준선
    workDays: string;         // 이 직원의 근무요일 CSV(직원 예외가 있으면 그 값)
  };
  days: {                     // 오늘·내일 이틀치. 각 날이 "일하는 날"인지와 쉬는 날 이름.
    date: string;             // "YYYY-MM-DD"
    isWorkday: boolean;       // 근무요일 ∧ 쉬는날 아님
    offDayName?: string;      // 공휴일·회사휴무일이면 이름(잠금화면에 "오늘은 휴무일입니다"로 표시)
  }[];
  approvedOvertime: {         // 승인된 연장근무만(대기·반려는 내려주지 않는다) — 이 시간대는 잠그지 않는다.
    date: string;             // "YYYY-MM-DD" 시작일
    startTime: string;        // "HH:MM"
    endTime: string;          // "HH:MM" (<= startTime이면 익일)
  }[];
  policyVersion: number;      // 앱이 캐시를 갱신할지 판단하는 용도(설정이 바뀌면 값이 달라진다)
};

// 정책 한 벌 만들기. userId는 인증된 기기의 주인이므로 호출자가 회사 격리를 이미 보장한다.
export async function buildPcOffPolicy(userId: string, companyId: string, now = new Date()): Promise<PcOffPolicy> {
  const [user, company] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { id: true, pcOffExempt: true, workDays: true },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        pcOffOn: true, pcOffMode: true, pcOffDelayMin: true, pcOffNotifyMins: true,
        pcOffTempUseMin: true, pcOffTempUsePerDay: true, pcOffTempReasons: true,
        workStartTime: true, workEndTime: true, workDays: true, holidayAutoOn: true,
        shiftMode: true, // 교대근무 회사 판정용(1차 미지원 — 아래에서 잠금 대상에서 제외)
      },
    }),
  ]);

  const serverTime = now.toISOString();
  // 회사·직원 정보가 없다 = 있을 수 없는 상태. 잠그지 않는 쪽으로 답한다(fail-open — 업무 우선).
  if (!user || !company) {
    return emptyPolicy(serverTime, "unknown");
  }

  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  // 근무요일 — 직원별 예외가 있으면 그 값, 없으면 회사 기본(기존 판정 규칙과 동일한 헬퍼 사용).
  const workDaySet = effectiveWorkDays(user.workDays, company.workDays);
  // 쉬는 날(공휴일 + 회사 휴무일) — 기존 화면들이 쓰는 것과 같은 로더.
  const offDays = await loadOffDays(companyId, company.holidayAutoOn, today, tomorrow);
  const offNames = await loadOffDayNames(companyId, company.holidayAutoOn, today, tomorrow);

  const days = [today, tomorrow].map((d) => {
    const iso = toISODate(d);
    const isOff = offDays.has(iso);
    return {
      date: iso,
      isWorkday: workDaySet.has(d.getDay()) && !isOff,
      ...(isOff && offNames.get(iso) ? { offDayName: offNames.get(iso) as string } : {}),
    };
  });

  // 승인된 연장근무. 대기·반려는 제외 — "승인분만 해제"가 원칙.
  //  · ⚠️ **어제 시작분부터** 가져온다: 야근은 자정을 넘길 수 있어(22:00~익일 02:00 = 어제 날짜로 저장)
  //    오늘 새벽 근무가 어제 건에 속한다. 오늘분만 가져오면 자정을 넘기는 순간 승인 사실이 사라져
  //    "승인받고 일하는 중에 잠기는" 사고가 난다.
  const overtimes = await prisma.overtimeRequest.findMany({
    where: {
      companyId, userId, status: "approved",
      targetDate: { gte: addDays(today, -1), lt: addDays(tomorrow, 1) },
    },
    select: { targetDate: true, startTime: true, endTime: true },
    orderBy: { targetDate: "asc" },
  });

  // 오늘 쓴 [일시사용] 횟수 — 서버가 센다(앱을 다시 설치해도 우회되지 않게).
  //  · ⚠️ 기준은 앱이 보낸 `at`이 아니라 **서버가 받은 시각(createdAt)**. `at`은 앱이 정하는 값이라
  //    "어제 일어난 일"이라고 보내면 횟수 제한을 무한히 피할 수 있다.
  const usedToday = await prisma.agentEvent.count({
    where: { companyId, userId, type: "temp_use", createdAt: { gte: today, lt: tomorrow } },
  });

  // 잠금 대상 판정. 하나라도 걸리면 잠그지 않는다(안전한 쪽).
  //  · 교대근무 회사는 1차 미지원 — 표준 퇴근시각으로 판단하면 야간조 근무 중에 잠긴다.
  //    조별 시각 해석(lib/shift-server.ts)을 태우는 건 2차 범위이므로, 그때까지는 아예 동작시키지 않는다.
  const disabledReason = !company.pcOffOn ? "company_off"
    : user.pcOffExempt ? "user_exempt"
    : company.shiftMode ? "shift_unsupported"
    : !company.workEndTime ? "no_worktime"
    : undefined;

  const notifyMins = parseNotifyMins(company.pcOffNotifyMins);

  return {
    serverTime,
    enabled: !disabledReason,
    ...(disabledReason ? { disabledReason } : {}),
    mode: company.pcOffMode,
    delayMin: company.pcOffDelayMin,
    notifyMins,
    tempUse: {
      minutes: company.pcOffTempUseMin, perDay: company.pcOffTempUsePerDay, usedToday,
      reasons: parseTempReasons(company.pcOffTempReasons),
    },
    work: {
      startTime: company.workStartTime,
      endTime: company.workEndTime,
      workDays: daysToCsv(workDaySet),
    },
    days,
    approvedOvertime: overtimes.map((o) => ({
      date: toISODate(o.targetDate), startTime: o.startTime, endTime: o.endTime,
    })),
    // 설정이 바뀌면 값이 달라지는 간단한 지문. 앱이 "정책이 바뀌었나"를 싸게 확인한다.
    policyVersion: fingerprint([
      company.pcOffOn, company.pcOffMode, company.pcOffDelayMin, company.pcOffNotifyMins,
      company.pcOffTempUseMin, company.pcOffTempUsePerDay, company.pcOffTempReasons,
      company.workStartTime, company.workEndTime, daysToCsv(workDaySet), user.pcOffExempt,
      ...days.map((d) => `${d.date}:${d.isWorkday}`),
      ...overtimes.map((o) => `${toISODate(o.targetDate)}:${o.startTime}-${o.endTime}`),
    ].join("|")),
  };
}

// 잠글 근거가 없을 때의 안전한 기본 응답(fail-open).
function emptyPolicy(serverTime: string, reason: string): PcOffPolicy {
  return {
    serverTime, enabled: false, disabledReason: reason,
    mode: "lock", delayMin: 10, notifyMins: [],
    tempUse: { minutes: 0, perDay: 0, usedToday: 0, reasons: [] },
    work: { startTime: null, endTime: null, workDays: "" },
    days: [], approvedOvertime: [], policyVersion: 0,
  };
}

// 쉬는 날 "이름"(잠금화면 안내문구용). 판정은 loadOffDays가 하고, 여기선 이름만 곁들인다.
async function loadOffDayNames(
  companyId: string, holidayAutoOn: boolean, start: Date, end: Date
): Promise<Map<string, string>> {
  const years = Array.from(new Set([start.getFullYear(), end.getFullYear()]));
  const [national, comp] = await Promise.all([
    holidayAutoOn ? prisma.holiday.findMany({ where: { year: { in: years } }, select: { date: true, name: true } }) : Promise.resolve([]),
    prisma.companyHoliday.findMany({ where: { companyId }, select: { date: true, name: true } }),
  ]);
  const m = new Map<string, string>();
  for (const h of national) m.set(h.date, h.name);
  for (const h of comp) m.set(h.date, h.name); // 회사 휴무일 이름이 우선(더 구체적)
  return m;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// 문자열 → 32비트 정수 지문(암호 용도 아님, 변경 감지용).
function fingerprint(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}
