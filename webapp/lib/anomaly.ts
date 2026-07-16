// 이상접속 판정 — "쌓인 접속기록 중 수상한 것만 골라낸다"(접속/보안 6단계).
//
// 설계 원칙:
//  ① **읽기 전용이다** — 여기서는 아무것도 저장하지 않는다. 기존 기록(recordAccess)·판정(ipMatches)·
//     출퇴근 로직을 한 줄도 건드리지 않는다. 이 파일이 통째로 사라져도 다른 기능은 멀쩡해야 한다.
//  ② **화면과 대시보드가 이 함수 하나만 쓴다** — 두 곳이 따로 세면 "배지는 3건인데 화면엔 5건"이 된다.
//  ③ **반드시 묶어서 센다** — 차단된 IP가 1분에 한 번 두드리면 하루 1,440건이다. 그대로 뿌리면
//     화면이 마비되어 오히려 아무것도 못 본다. IP별(+날짜별)로 묶어 "N회"로 접는다.
//  ④ **판정은 매번 다시 계산한다**(저장 안 함) — 규칙을 바꾸면 과거 표시도 바뀐다. 알림은 "지금 규칙으로
//     다시 본다"가 자연스러워 그대로 두되, 화면에 이 사실을 밝힌다.
//
// ⚠️ 정직한 한계: 이 판정은 전부 IP에 기대고 있다. IP를 못 믿으면 알림도 못 믿는다.
//    → 운영 배포 시 리버스 프록시가 X-Forwarded-For를 덮어써야 한다(project-status.md 🚨 배포 필수 조건).
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
  at: Date; // **마지막** 발생 시각 — 대시보드 배지(확인 시각 이후만 카운트)의 기준
  count: number;
};

// 대시보드 배지가 보는 기간. 무제한으로 보면 대시보드(가장 자주 열리는 화면)가 느려진다.
// ⚠️ 이 값 때문에 "7일보다 오래된 미확인 이상"은 배지에 안 잡힌다 — 화면에서 기간을 넓혀 봐야 한다(정직한 한계).
export const ALERT_BADGE_DAYS = 7;

// 한 번에 훑는 접속기록 상한. 초과하면 오래된 쪽이 잘려 **N회가 실제보다 적게** 나온다 → capped로 알린다.
const SCAN_LIMIT = 2000;

/**
 * 이 시각이 "심야"인가.
 * ⚠️ 심야는 자정을 넘어간다(22~06). 시작 > 끝이면 "시작 이후 **또는** 끝 이전"으로 판정한다.
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

/**
 * 기간 내 이상접속을 찾아 **최신순**으로 돌려준다.
 * @param companyId 회사 격리 — 반드시 내 회사만
 * @param start     조회 시작(포함)
 * @param end       조회 끝(미포함)
 * @param rules     회사 설정(규칙 on/off·임계값)
 * @returns capped=true면 기록이 상한을 넘어 잘렸다는 뜻(횟수가 실제보다 적을 수 있음)
 */
export async function detectAnomalies(
  companyId: string,
  start: Date,
  end: Date,
  rules: AlertRules
): Promise<{ anomalies: Anomaly[]; capped: boolean }> {
  // 판정에 필요한 종류만 가져온다(출퇴근·설정변경은 이상 판정 대상이 아님).
  // 최신순 + 상한 — 잘리더라도 **최근 것부터** 남는다(공격은 보통 지금 벌어지고 있다).
  const events = await prisma.accessEvent.findMany({
    where: {
      companyId,
      kind: { in: ["blocked", "login_fail", "login"] },
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: "desc" },
    take: SCAN_LIMIT,
    select: { kind: true, result: true, ip: true, actorName: true, emailTried: true, createdAt: true },
  });

  const out: Anomaly[] = [];

  // ── 규칙 1) 차단된 IP가 또 두드림 — IP별로 묶는다. 토글 없음(관리자가 직접 막은 IP = 오탐 0).
  const blockedByIp = new Map<string, { count: number; last: Date; names: Set<string> }>();
  // ── 규칙 2) 연속 로그인 실패 — IP + 하루 단위로 묶는다.
  const failByIpDay = new Map<string, { ip: string; count: number; last: Date; names: Set<string> }>();

  for (const e of events) {
    const ip = e.ip ?? "";
    const name = e.actorName ?? e.emailTried ?? "";

    if (e.kind === "blocked") {
      if (!ip) continue; // IP를 모르면 묶을 수가 없다
      const g = blockedByIp.get(ip);
      if (g) {
        g.count += 1;
        if (e.createdAt > g.last) g.last = e.createdAt;
        if (name) g.names.add(name);
      } else {
        blockedByIp.set(ip, { count: 1, last: e.createdAt, names: new Set(name ? [name] : []) });
      }
      continue;
    }

    if (e.kind === "login_fail" && rules.alertFailOn) {
      if (!ip) continue;
      const key = `${ip}|${dayKey(e.createdAt)}`;
      const g = failByIpDay.get(key);
      if (g) {
        g.count += 1;
        if (e.createdAt > g.last) g.last = e.createdAt;
        if (name) g.names.add(name);
      } else {
        failByIpDay.set(key, { ip, count: 1, last: e.createdAt, names: new Set(name ? [name] : []) });
      }
      continue;
    }

    // ── 규칙 3) 심야 로그인 — 성공한 로그인만. 묶지 않고 건별(누가 언제 들어왔는지가 핵심).
    if (e.kind === "login" && e.result === "success" && rules.alertNightOn) {
      if (!isNightHour(e.createdAt.getHours(), rules.alertNightStart, rules.alertNightEnd)) continue;
      out.push({
        id: `night:${e.createdAt.getTime()}:${ip}:${name}`,
        kind: "night_login",
        level: "mid",
        title: "심야 시간 로그인",
        detail: `${String(e.createdAt.getHours()).padStart(2, "0")}:${String(e.createdAt.getMinutes()).padStart(2, "0")} 로그인 성공`,
        who: name || "알 수 없음",
        ip: ip || "—",
        at: e.createdAt,
        count: 1,
      });
    }
  }

  for (const [ip, g] of blockedByIp) {
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

  for (const [key, g] of failByIpDay) {
    if (g.count < rules.alertFailCount) continue; // 임계값 미만은 이상이 아니다
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

  out.sort((a, b) => b.at.getTime() - a.at.getTime()); // 최신순
  return { anomalies: out, capped: events.length >= SCAN_LIMIT };
}

/**
 * 대시보드 배지용 — "관리자가 확인한 시각 이후" 새 이상이 몇 건인가.
 * ⚠️ 최근 ALERT_BADGE_DAYS일만 본다(대시보드는 가장 자주 열리는 화면 — 무거우면 안 된다).
 */
export async function countUncheckedAnomalies(
  companyId: string,
  rules: AlertRules,
  checkedAt: Date | null
): Promise<number> {
  const now = new Date();
  const start = new Date(now.getTime() - ALERT_BADGE_DAYS * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 1000); // 지금까지(시계 오차 여유)
  const { anomalies } = await detectAnomalies(companyId, start, end, rules);
  if (!checkedAt) return anomalies.length; // 한 번도 확인 안 함
  return anomalies.filter((a) => a.at > checkedAt).length;
}
