// 이상 접속(관리자 전용) — 쌓인 접속기록 중 **수상한 것만** 골라 보여준다(접속/보안 6단계).
//  · 회사 격리(companyId = 내 회사). 관리자만.
//  · 판정은 lib/anomaly.ts가 전담(대시보드 배지와 **같은 함수** — 두 곳이 다른 숫자를 말하면 안 된다).
//  · 기간: 기본 최근 7일(알림은 최신이 중요), 최대 92일 — 다른 보안 화면과 같은 상한 규칙.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { toISODate } from "@/lib/period";
import { detectAnomalies, countUncheckedAnomalies, badgeWindow, ALERT_BADGE_DAYS } from "@/lib/anomaly";
import { SecurityTabs } from "@/app/security/SecurityTabs";
import { AlertsClient, type AlertRow } from "./AlertsClient";

function fmtDateTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export default async function SecurityAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const todayISO = toISODate(new Date());
  // 기본 기간 = 대시보드 배지와 **같은 창**(badgeWindow). 직접 계산하면 안 된다 —
  // 배지는 시각 기준, 화면은 날짜 기준이라 창이 어긋나면 "배지는 켜졌는데 화면에선 끌 수 없는" 사고가 난다.
  const defFrom = toISODate(badgeWindow().start);
  const defTo = todayISO;
  const normISO = (s: string | undefined, fb: string): string => {
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00").getTime())) return s;
    return fb;
  };
  const fromISO = normISO(sp.from, defFrom);
  let toISO = normISO(sp.to, defTo);
  if (toISO < fromISO) toISO = fromISO;
  const start = new Date(fromISO + "T00:00:00");
  const endDay = new Date(toISO + "T00:00:00");
  let end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + 92);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: {
      securityCheckedAt: true,
      alertNightOn: true,
      alertNightStart: true,
      alertNightEnd: true,
      alertFailOn: true,
      alertFailCount: true,
    },
  });
  if (!company) redirect("/dashboard");

  const { anomalies, capped } = await detectAnomalies(me.companyId, start, end, company);

  // [확인함] 버튼의 건수는 **보고 있는 기간이 아니라 배지와 같은 창**에서 센다.
  // 이유: 이 버튼은 "이 시각 이전 전부"를 확인 처리한다(securityCheckedAt = now). 화면에 보이는 기간의
  // 건수를 라벨로 쓰면 "2건 확인"이라 말하고 실제로는 안 보이던 과거까지 묵살하는 거짓말이 된다.
  // 배지와 같은 숫자를 쓰면 버튼·배지·대시보드가 항상 일치한다.
  const unchecked = await countUncheckedAnomalies(me.companyId, company, company.securityCheckedAt);

  const checkedAt = company.securityCheckedAt;
  const rows: AlertRow[] = anomalies.map((a) => ({
    id: a.id,
    kind: a.kind,
    level: a.level,
    title: a.title,
    detail: a.detail,
    who: a.who,
    ip: a.ip,
    timeText: fmtDateTime(a.at),
    count: a.count,
    // 확인 시각 이후에 생긴 것 = 아직 안 본 것. 확인한 적이 없으면 전부 새 것이다.
    isNew: !checkedAt || a.at > checkedAt,
  }));

  return (
    <AppShell user={me} active="security" title="이상 접속" subtitle={me.company.name}>
      <SecurityTabs active="alerts" />
      <AlertsClient
        rows={rows}
        from={fromISO}
        to={toISO}
        todayISO={todayISO}
        capped={capped || unchecked.capped}
        newCount={unchecked.count}
        badgeDays={ALERT_BADGE_DAYS}
        checkedAtText={checkedAt ? checkedAt.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : null}
        rules={{
          nightOn: company.alertNightOn,
          nightStart: company.alertNightStart,
          nightEnd: company.alertNightEnd,
          failOn: company.alertFailOn,
          failCount: company.alertFailCount,
        }}
      />
    </AppShell>
  );
}
