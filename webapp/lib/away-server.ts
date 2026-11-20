// [단일 출처] 승인된 **출장·재택** 날짜 — "그날 사무실 밖에서 일하기로 **허가된** 날"을 돌려준다.
//                                                                      (사장님 결정 2026-11-21, A+C안)
//
// 왜 필요한가
//  · 출장·재택을 승인받은 날에 직원이 출퇴근을 누르지 않으면 **결근**으로 집계됐다. 관리자가 허가해 준 날이
//    법정 근로기록부에 "결근"으로 찍히면 노무 분쟁에서 회사에 불리하고, 직원에게도 억울하다.
//  · 그래서 **휴가와 같은 방식**으로 결근에서 빼고 '출장'/'재택' 줄로 남긴다.
//
// 🔴 **근무시간을 지어내지 않는다.** 그날 실근무시간은 **비워 둔다**(기록이 없으니 없다고 적는다).
//    소정근로시간을 일한 것으로 보는 방식(근로기준법 제58조 간주근로)은 요건·노사 합의가 따르므로
//    **노무사 확인 뒤 별도 결정**한다. 여기서 임의로 시간을 만들면 법정 기록이 거짓이 된다.
//
// 🔴 규칙을 여기 **한 곳**에만 둔다. 결근을 판정하는 곳이 리포트(lib/report-days.ts)·직원상세(lib/dayentries.ts)·
//    소급경고(lib/retroactive.ts)·대시보드로 나뉘어 있어, 각자 조회하면 화면마다 숫자가 달라진다.
import { prisma } from "@/lib/db";
import { toISODate } from "@/lib/period";

/** 그날 무엇으로 허가됐나. 화면 라벨에 그대로 쓴다. */
export type AwayKind = "trip" | "remote";

export const AWAY_LABEL: Record<AwayKind, string> = { trip: "출장", remote: "재택근무" };

/** userId → (날짜ISO → 출장/재택) */
export type AwayDays = Map<string, Map<string, AwayKind>>;

/** 한 직원의 날짜별 허가 종류(없으면 빈 Map). 호출부가 매번 `?? new Map()` 을 쓰지 않도록. */
const EMPTY: Map<string, AwayKind> = new Map();
export function awayOf(all: AwayDays, userId: string): Map<string, AwayKind> {
  return all.get(userId) ?? EMPTY;
}

/**
 * [start, end) 안에서 **승인된** 출장·재택을 날짜별로 펼쳐 돌려준다.
 *  · 회사 격리: companyId 필수.
 *  · 기간 밖 날짜는 담지 않는다 — 출장은 최대 366일까지 신청할 수 있어 그냥 펼치면 맵이 쓸데없이 커진다.
 *  · 같은 날 출장과 재택이 겹치면 **출장이 이긴다**(사무실 밖 근무라는 사실은 같고, 출장이 더 구체적인 사유다).
 */
export async function loadAwayDays(companyId: string, start: Date, end: Date): Promise<AwayDays> {
  const [trips, remotes] = await Promise.all([
    // (조회 조건을 바꾸면 아래 buildAwayDays 를 쓰는 리포트 쪽 조회도 함께 맞출 것)
    prisma.businessTripRequest.findMany({
      where: { companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, startDate: true, endDate: true },
    }),
    prisma.remoteWorkRequest.findMany({
      where: { companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
      select: { userId: true, startDate: true, endDate: true },
    }),
  ]);

  return buildAwayDays(trips, remotes, start, end);
}

type AwayRow = { userId: string; startDate: Date; endDate: Date };

/** 이미 읽어 둔 출장·재택 행을 날짜별로 펼친다(리포트는 같은 행을 사유 라벨에도 써서 다시 조회하지 않는다).
 *  🔴 펼치는 규칙은 여기 하나뿐이다 — 두 벌이 되면 화면마다 날짜가 달라진다. */
export function buildAwayDays(trips: AwayRow[], remotes: AwayRow[], start: Date, end: Date): AwayDays {
  const out: AwayDays = new Map();
  // 재택을 먼저 넣고 출장을 나중에 넣어 덮어쓴다 → 겹치면 출장이 남는다.
  const add = (rows: { userId: string; startDate: Date; endDate: Date }[], kind: AwayKind) => {
    for (const r of rows) {
      let m = out.get(r.userId);
      if (!m) {
        m = new Map<string, AwayKind>();
        out.set(r.userId, m);
      }
      const first = new Date(r.startDate.getFullYear(), r.startDate.getMonth(), r.startDate.getDate());
      const cur = first < start ? new Date(start) : first;
      const last = new Date(r.endDate.getFullYear(), r.endDate.getMonth(), r.endDate.getDate());
      while (cur <= last && cur < end) {
        m.set(toISODate(cur), kind);
        cur.setDate(cur.getDate() + 1);
      }
    }
  };
  add(remotes, "remote");
  add(trips, "trip");
  return out;
}
