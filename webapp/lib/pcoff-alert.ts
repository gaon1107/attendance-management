// PC-OFF 미보고 감시 — "잠겼어야 하는데 잠금 기록이 안 온 PC"를 찾아 관리자에게 알린다.
//
// 왜 필요한가 (설치형 앱의 구조적 한계)
//  · 직원이 작업관리자로 PC 앱을 끄면 잠금이 풀린다. 이것은 개발지시서 §0이 워치독(강제종료 방지)을
//    범위 밖으로 둔 결과이고, 사장님 결정(잠금 강도 A안)이기도 하다.
//  · 클라이언트 방어는 어차피 뚫리므로, **서버가 "기록이 안 왔다"를 알아채는 것이 유일한 실질 방어선**이다.
//    잠금을 강제하지는 못하지만, 안 잠긴 PC가 조용히 넘어가는 일은 막는다.
//
// ⚠️ 이 파일은 기존 데이터를 **읽기만** 한다. 근무시간·휴일·기기·사건을 만들거나 고치지 않는다.
// ⚠️ 서버 전용(prisma·holiday-server import). 브라우저에서 쓰는 PC-OFF 규칙은 lib/pcoff.ts(순수)에 있다.
//
// 이 감시가 잡는 것과 못 잡는 것 (정직한 범위)
//  · 잡는다: 앱을 끈 PC / 앱이 죽은 PC / 네트워크가 끊긴 채 방치된 PC → "기록이 없다"로 드러난다.
//  · 못 잡는다: 앱을 고쳐 가짜 잠금 기록을 보내는 것. 판단 기준이 앱이 보낸 `at` 값이기 때문이다.
//    (서버 수신시각 `createdAt`을 쓰면 오프라인 후 뒤늦게 올라온 정상 기록을 미보고로 오판한다.
//     거짓 경고는 감시 장치를 무용지물로 만들므로, 여기서는 오탐을 없애는 쪽을 택했다.)
import { prisma } from "./db";
import { loadOffDays } from "./holiday-server";
import { effectiveWorkDays } from "./workdays";
import { toISODate } from "./period";

/**
 * 퇴근 기준시각 + 유예가 지난 뒤 **이만큼 더** 기다렸다가 판단한다.
 *  · 왜 필요한가: 잠금은 기준시각 정각에 일어나지만 기록이 서버에 닿기까지 시간이 걸린다
 *    (앱의 판정 주기 10초 + 전송 재시도). 여유 없이 판단하면 정상 PC가 매일 경고로 뜬다.
 */
export const PCOFF_ALERT_GRACE_MIN = 30;

/** 검사하는 날짜 수(오늘·어제). 그 이상 과거는 이미 알림으로 떴을 것이므로 다시 세지 않는다. */
const CHECK_DAYS = 2;

/**
 * 잠금 기록이 이 시간 안에 들어왔으면 "보고됨"으로 본다.
 *  · 밤새 오프라인이었다가 아침에 올라오는 경우까지 정상으로 받아들이기 위한 여유다.
 */
const REPORT_WINDOW_HOURS = 14;

/** 한 번에 훑는 잠금 기록 수 상한. 이 수를 넘으면 판단을 포기한다(아래 설명 참조). */
const EVENT_SCAN_LIMIT = 5000;

/**
 * 잠금 기록을 보낼 수 있는 최소 앱 버전.
 *  · ⚠️ **이 값이 이 감시 장치의 안전장치다.** 2-B(0.2.0) 앱은 기록을 하나도 보내지 않으므로,
 *    버전을 가리지 않으면 정상 동작 중인 PC가 전부 "미보고"로 뜬다(거짓 경고).
 *  · 2-C에서 앱이 기록 전송을 갖추고 `AppInfo.Version`을 0.3.0으로 올리는 순간
 *    이 감시가 스스로 작동을 시작한다.
 */
export const MIN_REPORTING_AGENT_VERSION = "0.3.0";

export type PcOffUnreported = {
  deviceId: string;
  deviceName: string;
  userName: string;
  /** 잠겼어야 했던 날짜 "YYYY-MM-DD" */
  date: string;
  /** 잠겼어야 했던 시각(퇴근 기준시각 + 유예) */
  dueAt: Date;
  lastSeenAt: Date | null;
  agentVersion: string | null;
};

/**
 * 이 앱 버전이 잠금 기록을 보낼 수 있는가.
 *  · 형식을 못 읽으면 <b>false</b>(감시하지 않는다) — 모르는 것을 근거로 경고하지 않는다.
 */
export function supportsEventReports(version: string | null | undefined): boolean {
  const m = /^\s*(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major > 0) return true;
  return minor >= 3;
}

/** "HH:MM" → 자정부터의 분. 읽을 수 없으면 null. (글자 비교는 "9:00" > "10:00"으로 뒤집히므로 반드시 숫자로) */
function hmToMinutes(hm: string | null | undefined): number | null {
  const parts = String(hm ?? "").split(":");
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

/**
 * 미보고 PC 목록. 최신(늦게 잠겼어야 하는 것)부터.
 *
 * 판단 규칙 — 하나라도 걸리면 세지 않는다(거짓 경고 금지)
 *  · 회사가 PC-OFF를 끔 / 교대근무 회사(1차 미지원) / 퇴근 기준시각 미설정 → 아예 감시하지 않음
 *  · 예외자·퇴사자·해제된 기기 → 대상 아님
 *  · 앱 버전이 기록을 보낼 수 없는 버전 → 대상 아님(위 MIN_REPORTING_AGENT_VERSION 설명 참조)
 *  · 근무일이 아닌 날, 아직 "퇴근+유예+여유"가 지나지 않은 날 → 판단할 시점이 아님
 */
export async function listPcOffUnreported(
  companyId: string,
  now = new Date()
): Promise<{ items: PcOffUnreported[]; total: number }> {
  const empty = { items: [] as PcOffUnreported[], total: 0 };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      pcOffOn: true, pcOffDelayMin: true,
      workEndTime: true, workDays: true, holidayAutoOn: true,
      shiftMode: true, // 교대근무 회사는 표준 퇴근시각으로 판단할 수 없다(정책 조립과 같은 이유)
    },
  });
  if (!company || !company.pcOffOn || company.shiftMode) return empty;

  const endMin = hmToMinutes(company.workEndTime);
  if (endMin === null) return empty;

  const delayMin = Number.isInteger(company.pcOffDelayMin) && company.pcOffDelayMin >= 0
    ? company.pcOffDelayMin
    : 0;

  // 감시 대상 기기: 해제되지 않은 기기 중, 예외자·퇴사자가 아니고, 기록을 보낼 수 있는 버전.
  const devices = await prisma.agentDevice.findMany({
    where: { companyId, revokedAt: null, user: { deactivatedAt: null, pcOffExempt: false } },
    select: {
      id: true, deviceName: true, agentVersion: true, lastSeenAt: true,
      user: { select: { name: true, workDays: true } },
    },
  });
  const watched = devices.filter((d) => supportsEventReports(d.agentVersion));
  if (watched.length === 0) return empty;

  // 검사할 날짜(오늘·어제)와 그 기간의 쉬는 날 — 기존 화면들이 쓰는 것과 같은 로더를 재사용한다.
  const todayStart = startOfDay(now);
  const dates: Date[] = [];
  for (let i = CHECK_DAYS - 1; i >= 0; i--) dates.push(addDays(todayStart, -i));
  const offDays = await loadOffDays(companyId, company.holidayAutoOn, dates[0], dates[dates.length - 1]);

  // 잠금 기록을 한 번에 훑는다(기기마다 따로 묻지 않는다).
  //  · 상한에 걸리면 일부 기록을 못 본 것이므로 **판단을 포기한다** — 안 본 기록을 근거로
  //    "안 보냈다"고 경고하면 정상 PC가 경고로 뜬다.
  const scanFrom = addDays(dates[0], -1);
  const scanTo = addDays(todayStart, 2);
  const lockEvents = await prisma.agentEvent.findMany({
    where: { companyId, type: "lock", at: { gte: scanFrom, lt: scanTo } },
    select: { deviceId: true, at: true },
    take: EVENT_SCAN_LIMIT,
  });
  if (lockEvents.length >= EVENT_SCAN_LIMIT) {
    console.warn("[pcoff-alert] 잠금 기록이 너무 많아 미보고 판단을 건너뜁니다(거짓 경고 방지).");
    return empty;
  }

  // 기기별 잠금 기록 시각 목록
  const byDevice = new Map<string, Date[]>();
  for (const e of lockEvents) {
    const list = byDevice.get(e.deviceId);
    if (list) list.push(e.at);
    else byDevice.set(e.deviceId, [e.at]);
  }

  const items: PcOffUnreported[] = [];

  for (const d of watched) {
    const workDaySet = effectiveWorkDays(d.user.workDays, company.workDays);
    const reported = byDevice.get(d.id) ?? [];

    for (const day of dates) {
      const iso = toISODate(day);
      if (!workDaySet.has(day.getDay()) || offDays.has(iso)) continue; // 근무일이 아니면 잠글 이유가 없다

      // 잠겼어야 하는 시각. 퇴근 23:30 + 유예 60분처럼 자정을 넘어도 자연히 다음 날로 넘어간다.
      const dueAt = addMinutes(day, endMin + delayMin);

      // 아직 판단할 시점이 아니다(기록이 오는 중일 수 있다).
      if (addMinutes(dueAt, PCOFF_ALERT_GRACE_MIN) > now) continue;

      const windowEnd = new Date(dueAt.getTime() + REPORT_WINDOW_HOURS * 3600_000);
      const hasReport = reported.some((at) => at >= dueAt && at < windowEnd);
      if (hasReport) continue;

      items.push({
        deviceId: d.id,
        deviceName: d.deviceName,
        userName: d.user.name,
        date: iso,
        dueAt,
        lastSeenAt: d.lastSeenAt,
        agentVersion: d.agentVersion,
      });
    }
  }

  items.sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime());
  return { items, total: items.length };
}
