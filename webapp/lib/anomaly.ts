// 이상접속 판정 — "쌓인 접속기록 중 수상한 것만 골라낸다"(접속/보안 6단계).
//
// 설계 원칙:
//  ① **읽기 전용이다** — 여기서는 아무것도 저장하지 않는다. 기존 기록(recordAccess)·판정(ipMatches)·
//     출퇴근 로직을 한 줄도 건드리지 않는다. 이 파일이 통째로 사라져도 다른 기능은 멀쩡해야 한다.
//  ② **화면과 대시보드가 이 함수 하나만 쓴다** — 두 곳이 따로 세면 "배지는 3건인데 화면엔 0건"이 된다.
//     기간 계산도 badgeWindow() 하나로 통일한다(창이 어긋나면 배지를 끌 수 없는 사고가 난다 — 실제로 겪음).
//  ③ **반드시 묶어서 센다** — 차단된 IP가 1분에 한 번 두드리면 하루 1,440건이다. 그대로 뿌리면
//     화면이 마비되어 오히려 아무것도 못 본다. IP별(+날짜별)로 묶어 "N회"로 접는다.
//  ④ **판정은 매번 다시 계산한다**(저장 안 함) — 규칙을 바꾸면 과거 표시도 바뀐다. 알림은 "지금 규칙으로
//     다시 본다"가 자연스러워 그대로 두되, 화면에 이 사실을 밝힌다.
//  ⑤ **규칙끼리 서로를 굶기지 않는다** — 규칙마다 **따로 조회**한다. 한 덩어리로 긁어 상한을 나눠 쓰면,
//     시끄러운 차단 IP 하나가 상한을 다 먹어 심야·실패 이상이 통째로 사라진다.
//     = "경보를 많이 울리는 것"이 경보를 죽이는 가장 쉬운 방법이 된다. 검수에서 잡힌 실제 결함.
//     그중 [차단 IP 재시도]는 **DB 집계(groupBy)**라 상한 자체가 없다 — 끌 수 없는 규칙이니 절대 안 놓친다.
//
// ⚠️ 정직한 한계:
//  · 이 판정은 전부 IP에 기대고 있다. IP를 못 믿으면 알림도 못 믿는다.
//    → 운영 배포 시 리버스 프록시가 X-Forwarded-For를 덮어써야 한다(project-status.md 🚨 배포 필수 조건).
//    설정이 없으면 모든 직원이 같은 IP로 보여 "한 IP에서 실패 N회" 오탐이 난다.
//  · 실패 묶음은 **자정 기준 하루**다. 23:50에 4회 + 00:05에 4회처럼 자정을 걸치면 각각 4회로 쪼개져
//    임계값(기본 5)을 안 넘는다. 정석은 슬라이딩 24시간이나, 계정 잠금(5회)이 이 구멍을 함께 막고 있다.
//    화면에 "자정 기준으로 끊어 셉니다"를 밝혀 둔다.
import { prisma } from "@/lib/db";

// 회사 설정에서 판정에 필요한 값만 추린 것(Company의 일부).
export type AlertRules = {
  alertNightOn: boolean;
  alertNightStart: number;
  alertNightEnd: number;
  alertFailOn: boolean;
  alertFailCount: number;
};

export type AnomalyKind = "blocked_retry" | "fail_burst" | "night_login";

export type Anomaly = {
  id: string; // 화면 목록 key (kind + 묶음 기준으로 생성 — 같은 묶음이면 같은 id)
  kind: AnomalyKind;
  level: "high" | "mid"; // 표시 강조용
  title: string; // "차단된 IP가 로그인 시도"
  detail: string; // "47회 시도"
  who: string; // 관련된 사람(모르면 "알 수 없음")
  ip: string;
  at: Date; // **마지막** 발생 시각 — 배지(확인 시각 이후만 카운트)의 기준
  count: number;
};

// 배지·알림 화면 기본 기간(일). 무제한으로 보면 대시보드(가장 자주 열리는 화면)가 느려진다.
// ⚠️ 이 값 때문에 이보다 오래된 미확인 이상은 배지에 안 잡힌다 — 화면에서 기간을 넓혀 봐야 한다(정직한 한계).
export const ALERT_BADGE_DAYS = 7;

// 한 규칙이 훑는 기록 상한. 초과하면 오래된 쪽이 잘려 **이상이 아예 안 보일 수도** 있다 → capped로 알린다.
// (차단 IP 재시도는 DB 집계라 이 상한을 안 탄다)
const SCAN_LIMIT = 5000;

/**
 * 배지·알림 화면이 **공통으로** 쓰는 기간. 두 곳이 이 함수를 써야 창이 어긋나지 않는다.
 * ⚠️ 시작을 "자정"에 맞추는 이유 2가지:
 *   ① 화면 달력은 날짜 단위(00:00)라 시각 기준으로 잡으면 배지만 보고 화면은 못 보는 구간이 생긴다
 *      → 배지는 켜졌는데 화면에선 [확인함]이 비활성 = 관리자가 배지를 끌 수 없다(검수에서 잡힌 실제 결함).
 *   ② "하루 N회 실패" 묶음이 창 경계에서 잘리지 않는다(하루가 통째로 들어온다).
 */
export function badgeWindow(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (ALERT_BADGE_DAYS - 1));
  const end = new Date(now.getTime() + 1000); // 지금까지(시계 오차 여유)
  return { start, end };
}

/**
 * 이 시각이 "심야"인가.
 * ⚠️ 심야는 자정을 넘어간다(22~06). 시작 > 끝이면 "시작 이후 **또는** 끝 이전"으로 판정한다.
 * 끝 시각은 **미포함**이다(22~06이면 06:00은 정상).
 * 시작 = 끝이면 하루 종일이 심야가 되어 알림이 폭발하므로 **false**(안 울림)로 막는다.
 * (저장 시에도 거부하지만, 잘못된 값이 어떤 경로로 들어와도 알림이 터지지 않게 여기서 한 번 더 막는다)
 */
export function isNightHour(hour: number, start: number, end: number): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || start > 23 || end < 0 || end > 23) return false;
  if (start === end) return false; // 하루 종일 = 심야 없음으로 취급(안전)
  if (start > end) return hour >= start || hour < end; // 자정 넘김 (예: 22~06)
  return hour >= start && hour < end; // 같은 날 안 (예: 01~05)
}

// "YYYY-MM-DD" (로컬 기준) — 실패 묶음의 "하루" 기준
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 여러 사람이 얽힌 묶음의 표시용 이름 — "홍길동 외 2명"
function whoLabel(names: Set<string>): string {
  const list = [...names].filter(Boolean);
  if (list.length === 0) return "알 수 없음";
  if (list.length === 1) return list[0];
  return `${list[0]} 외 ${list.length - 1}명`;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 기간 내 이상접속을 찾아 **최신순**으로 돌려준다.
 * @param companyId 회사 격리 — 반드시 내 회사만
 * @param start     조회 시작(포함)
 * @param end       조회 끝(미포함)
 * @param rules     회사 설정(규칙 on/off·임계값)
 * @returns capped=true면 기록이 상한을 넘어 잘렸다는 뜻 — **일부 이상이 목록에 아예 없을 수 있다.**
 */
export async function detectAnomalies(
  companyId: string,
  start: Date,
  end: Date,
  rules: AlertRules
): Promise<{ anomalies: Anomaly[]; capped: boolean }> {
  const out: Anomaly[] = [];
  let capped = false;
  const range = { gte: start, lt: end };

  // ── 규칙 1) 차단된 IP가 또 두드림 ─────────────────────────────────
  // 끌 수 없는 규칙(관리자가 직접 막은 IP = 오탐 0)이라 **절대 놓치면 안 된다** → DB 집계로 상한을 없앤다.
  // ip+actorName으로 묶어 받은 뒤 ip 기준으로 다시 합친다(이름은 표시용).
  const blockedGroups = await prisma.accessEvent.groupBy({
    by: ["ip", "actorName"],
    where: { companyId, kind: "blocked", createdAt: range, ip: { not: null } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const byIp = new Map<string, { count: number; last: Date; names: Set<string> }>();
  for (const g of blockedGroups) {
    const ip = (g.ip ?? "").trim();
    if (!ip) continue; // 빈 문자열 IP는 묶을 수 없다(ip: {not: null}은 ""를 막지 못함)
    const last = g._max.createdAt ?? start;
    const cur = byIp.get(ip);
    if (!cur) {
      byIp.set(ip, { count: g._count._all, last, names: new Set(g.actorName ? [g.actorName] : []) });
    } else {
      cur.count += g._count._all;
      if (last > cur.last) cur.last = last;
      if (g.actorName) cur.names.add(g.actorName);
    }
  }
  for (const [ip, g] of byIp) {
    out.push({
      id: `blocked:${ip}`,
      kind: "blocked_retry",
      level: "high",
      title: "차단된 IP가 로그인 시도",
      detail: `${g.count}회 시도`,
      who: whoLabel(g.names),
      ip,
      at: g.last,
      count: g.count,
    });
  }

  // ── 규칙 2) 연속 로그인 실패 ──────────────────────────────────────
  // 2단계로 나눈다: ① DB 집계로 "기간 누적이 임계값 이상인 IP"만 추린다(후보는 보통 0~몇 개)
  //                ② 그 IP들의 기록만 가져와 **하루 단위**로 정확히 묶는다
  // → 전체를 긁지 않으니 시끄러운 IP가 다른 규칙을 굶기지 않는다.
  // 기간 누적 ≥ 임계값은 하루 묶음 ≥ 임계값의 필요조건이라 후보에서 새는 이상은 없다.
  if (rules.alertFailOn) {
    const failByIp = await prisma.accessEvent.groupBy({
      by: ["ip"],
      where: { companyId, kind: "login_fail", createdAt: range, ip: { not: null } },
      _count: { _all: true },
    });
    const candIps = failByIp
      .filter((c) => (c.ip ?? "").trim() && c._count._all >= rules.alertFailCount)
      .map((c) => c.ip as string);

    if (candIps.length > 0) {
      const rows = await prisma.accessEvent.findMany({
        where: { companyId, kind: "login_fail", createdAt: range, ip: { in: candIps } },
        select: { ip: true, actorName: true, emailTried: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: SCAN_LIMIT + 1, // +1로 "정확히 상한"과 "잘림"을 구분한다(경계 오탐 방지)
      });
      if (rows.length > SCAN_LIMIT) {
        capped = true;
        rows.length = SCAN_LIMIT;
      }

      const byIpDay = new Map<string, { ip: string; count: number; last: Date; names: Set<string> }>();
      for (const e of rows) {
        const ip = (e.ip ?? "").trim();
        if (!ip) continue;
        const name = e.actorName ?? e.emailTried ?? "";
        const key = `${ip}|${dayKey(e.createdAt)}`;
        const cur = byIpDay.get(key);
        if (!cur) byIpDay.set(key, { ip, count: 1, last: e.createdAt, names: new Set(name ? [name] : []) });
        else {
          cur.count += 1;
          if (e.createdAt > cur.last) cur.last = e.createdAt;
          if (name) cur.names.add(name);
        }
      }
      for (const [key, g] of byIpDay) {
        if (g.count < rules.alertFailCount) continue; // 그 날 기준으로는 임계값 미만
        out.push({
          id: `fail:${key}`,
          kind: "fail_burst",
          level: "high",
          title: "로그인 실패 반복",
          detail: `하루 ${g.count}회 실패`,
          who: whoLabel(g.names),
          ip: g.ip,
          at: g.last,
          count: g.count,
        });
      }
    }
  }

  // ── 규칙 3) 심야 로그인 ───────────────────────────────────────────
  // 성공한 로그인만. 묶지 않고 건별(누가 언제 들어왔는지가 핵심).
  // "몇 시인가"는 DB에서 거르기 어려워(시간대 변환) 가져와서 판정한다. 다만 대상이 **성공 로그인**이라
  // 공격자가 부풀릴 수 없고(비밀번호를 알아야 함) 직원 수에 비례하는 양이라 상한 안에 들어온다.
  if (rules.alertNightOn) {
    const logins = await prisma.accessEvent.findMany({
      where: { companyId, kind: "login", result: "success", createdAt: range },
      select: { ip: true, actorName: true, emailTried: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT + 1,
    });
    if (logins.length > SCAN_LIMIT) {
      capped = true;
      logins.length = SCAN_LIMIT;
    }
    for (const e of logins) {
      if (!isNightHour(e.createdAt.getHours(), rules.alertNightStart, rules.alertNightEnd)) continue;
      const name = e.actorName ?? e.emailTried ?? "";
      const ip = (e.ip ?? "").trim();
      out.push({
        id: `night:${e.createdAt.getTime()}:${ip}:${name}`,
        kind: "night_login",
        level: "mid",
        title: "심야 시간 로그인",
        detail: `${hhmm(e.createdAt)} 로그인 성공`,
        who: name || "알 수 없음",
        ip: ip || "—",
        at: e.createdAt,
        count: 1,
      });
    }
  }

  out.sort((a, b) => b.at.getTime() - a.at.getTime()); // 최신순
  return { anomalies: out, capped };
}

/**
 * 배지·[확인함] 버튼용 — "관리자가 확인한 시각 이후" 새 이상이 몇 건인가.
 * ⚠️ 최근 ALERT_BADGE_DAYS일(badgeWindow)만 본다. 알림 화면도 **같은 창**을 기본값으로 써야 한다.
 * @returns capped=true면 숫자가 실제보다 적을 수 있다 — 화면에 "N건+"처럼 정직하게 표시할 것.
 */
export async function countUncheckedAnomalies(
  companyId: string,
  rules: AlertRules,
  checkedAt: Date | null
): Promise<{ count: number; capped: boolean }> {
  const { start, end } = badgeWindow();
  const { anomalies, capped } = await detectAnomalies(companyId, start, end, rules);
  const count = checkedAt ? anomalies.filter((a) => a.at > checkedAt).length : anomalies.length;
  return { count, capped };
}
