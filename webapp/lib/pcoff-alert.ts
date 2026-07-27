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
import { TEMP_USE_OFFLINE_TYPE, EVENT_MAX_AGE_DAYS, offlineTempUsePerDay } from "./pcoff";

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

// ─────────────────── 오프라인 [일시사용] 한도 초과 감지 ───────────────────
// 왜 필요한가
//  · 인터넷이 끊긴 동안에는 앱이 자기 파일(usage.bin)로만 횟수를 센다. 그 파일과 대기줄을 지우고
//    앱을 껐다 켜면 오프라인 한도가 되살아난다(Core/OfflineUsageStore.cs에 정직하게 적어 둔 한계).
//    설치형 앱만으로는 막을 수 없다 — "작업관리자로 끄면 풀린다"와 같은 급의 문제다.
//  · 대신 기록이 올라오면 서버가 세어 볼 수 있다. 위 미보고 감시와 같은 접근이다:
//    막지는 못해도 **조용히 넘어가지는 않게** 한다.
//
// 잡는 것과 못 잡는 것 (정직한 범위 — 위 미보고 감시와 같은 기준으로 적는다)
//  · 잡는다: usage.bin·대기줄을 지우고 앱을 다시 켜 한도를 되살려 쓴 경우 → 기록이 올라오면 드러난다.
//  · 🔴 **못 잡는다 ①**: 오프라인 중 PC 시계를 하루 앞으로 돌리는 것. 앱은 새 날로 보고 한도를 리셋하고,
//    그때 만든 기록의 `at`은 미래라 서버가 EVENT_FUTURE_TOLERANCE_MIN(60분)을 넘는 것으로 보고 **버린다**.
//    → 사용도 무제한이고 기록도 남지 않는다. 여기서는 막을 수 없다(앱 쪽 ServerClock의 알려진 한계).
//  · 못 잡는다 ②: 45일(EVENT_MAX_AGE_DAYS)이 지나 올라온 기록, 앱 대기줄 상한(1200건)을 넘어 버려진 기록.
//  · ⚠️ 그러므로 **"경고 없음 = 이상 없음"이 아니다.** 이 목록은 "드러난 것"만 보여준다.
//
// ⚠️ 강제 차단이 아니다. [PC관리] 화면에 보여줄 뿐이고, 직원의 사용을 서버가 되돌리지 않는다
//    (이미 지나간 일이고, 오탐 가능성도 있어 관리자 판단에 맡긴다 — 아래 판단 규칙 참고).

/**
 * 최근 며칠분을 볼지.
 *  · 🔴 **서버가 받아 주는 기간(EVENT_MAX_AGE_DAYS)과 같아야 한다.** 짧게 잡으면
 *    "오래 끊길수록 안 걸린다"가 되어, 이 감시가 가장 필요한 경우(한 달 오프라인)에 반대로 동작한다.
 *    예: 14일로 두면 20일간 오프라인이던 PC의 앞부분 기록은 올라오는 순간 이미 창 밖이라 영영 안 뜬다(검수 치명 C-1).
 */
const OVERUSE_CHECK_DAYS = EVENT_MAX_AGE_DAYS;

/** 한 번에 훑는 오프라인 일시사용 기록 수 상한. 넘으면 **일부만 세므로 적게 나온다**(과다 경고는 나지 않는다). */
const OVERUSE_SCAN_LIMIT = 3000;

export type PcOffOfflineOveruse = {
  userId: string;
  userName: string;
  /** 그날 쓴 PC 이름(여러 대면 여럿). 한도는 사람 기준이므로 대수는 표시용이다. */
  deviceNames: string[];
  /** 사용한 날 "YYYY-MM-DD" (앱이 알려온 시각 기준) */
  date: string;
  /** 그날 오프라인에서 쓴 횟수 */
  used: number;
  /** 그날 허용치(회) */
  allowed: number;
};

/**
 * 오프라인 [일시사용]을 하루 허용치보다 많이 쓴 직원·날짜 목록. **최근 날짜부터**(같은 날은 많이 쓴 순).
 *
 * 판단 규칙
 *  · 회사가 PC-OFF를 끄거나 교대근무 회사면 감시하지 않는다(미보고 감시와 같은 기준).
 *  · 🔴 세는 단위는 **직원(userId)**이다. 기기별로 세면 PC 두 대를 연결한 직원이 각 6회씩 12회를 써도
 *    한 건도 안 뜬다 — 서버가 실제로 거는 한도(pcoff-policy.ts)가 직원 기준이기 때문이다(검수 M-1).
 *  · 허용치는 **지금 설정 기준**으로 계산한다. 그래서 관리자가 최근에 [일시사용] 설정을 줄였다면
 *    그 이전에 정당하게 쓴 사용분이 초과로 보일 수 있다 → 화면 안내문에 이 점을 밝힌다(오탐을 숨기지 않는다).
 *  · 허용치가 0인 회사(일시사용 안 씀)에서 오프라인 사용 기록이 있으면 그 자체가 초과다.
 *  · `capped`가 true면 기록이 너무 많아 **일부만 셌다**는 뜻이다(실제는 더 많을 수 있다 → 화면에 표시).
 */
export async function listOfflineTempUseOveruse(
  companyId: string,
  now = new Date()
): Promise<{ items: PcOffOfflineOveruse[]; total: number; capped: boolean }> {
  const empty = { items: [] as PcOffOfflineOveruse[], total: 0, capped: false };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { pcOffOn: true, pcOffTempUseMin: true, pcOffTempUsePerDay: true, shiftMode: true },
  });
  // 교대근무 회사는 PC-OFF 자체를 동작시키지 않는다(pcoff-policy.ts와 같은 기준) → 옛 기록으로 경고하지 않는다.
  if (!company || !company.pcOffOn || company.shiftMode) return empty;

  // 앱이 쓰는 것과 **같은 함수**로 허용치를 구한다(서버·앱이 다른 숫자를 보면 감시가 거짓말을 한다).
  const allowed = offlineTempUsePerDay(company.pcOffTempUseMin, company.pcOffTempUsePerDay);

  const from = addDays(startOfDay(now), -(OVERUSE_CHECK_DAYS - 1));
  const rows = await prisma.agentEvent.findMany({
    where: { companyId, type: TEMP_USE_OFFLINE_TYPE, at: { gte: from } },
    select: { at: true, userId: true, user: { select: { name: true } }, device: { select: { deviceName: true } } },
    // ⚠️ orderBy가 없으면 상한에 걸릴 때 인덱스 순서(오래된 것부터)로 채워져 **최근 날짜가 통째로 잘린다**.
    //    관리자가 조치해야 하는 건 최근 것이므로 최신부터 가져온다(검수 M-2).
    orderBy: { at: "desc" },
    take: OVERUSE_SCAN_LIMIT,
  });
  const capped = rows.length >= OVERUSE_SCAN_LIMIT;
  if (capped) {
    console.warn("[pcoff-alert] 오프라인 일시사용 기록이 많아 일부만 세었습니다(실제보다 적게 나올 수 있음).");
  }

  // (직원, 날짜)별로 센다. 날짜는 **앱이 알려온 시각(at)** 기준 — 언제 올라왔는지가 아니라 언제 썼는지가 기준이다.
  //  · ⚠️ 서버 TZ=Asia/Seoul 전제(toISODate는 서버 로컬 기준). 앱은 +09:00으로 하루를 세므로
  //    서버가 다른 시간대에 뜨면 날짜 경계가 어긋나 **무고한 직원이 초과로 보일 수 있다**(저장소 공통 전제).
  const bucket = new Map<string, PcOffOfflineOveruse>();
  for (const r of rows) {
    const date = toISODate(r.at);
    const key = `${r.userId}|${date}`;
    const hit = bucket.get(key);
    if (hit) {
      hit.used += 1;
      if (!hit.deviceNames.includes(r.device.deviceName)) hit.deviceNames.push(r.device.deviceName);
    } else {
      bucket.set(key, {
        userId: r.userId,
        userName: r.user.name,
        deviceNames: [r.device.deviceName],
        date,
        used: 1,
        allowed,
      });
    }
  }

  const items = [...bucket.values()].filter((x) => x.used > allowed);
  items.sort((a, b) => (b.date === a.date ? b.used - a.used : b.date.localeCompare(a.date)));
  return { items, total: items.length, capped };
}
