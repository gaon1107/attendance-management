// 이상 접속(관리자 전용) — 쌓인 접속기록 중 **수상한 것만** 골라 보여준다(접속/보안 6단계).
//  · 회사 격리(companyId = 내 회사). 관리자만.
//  · 판정은 lib/anomaly.ts가 전담(대시보드 배지와 **같은 함수** — 두 곳이 다른 숫자를 말하면 안 된다).
//  · 기간: 기본 최근 7일(알림은 최신이 중요), 최대 92일 — 다른 보안 화면과 같은 상한 규칙.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { toISODate } from "@/lib/period";
import { detectAnomalies, ALERT_BADGE_DAYS } from "@/lib/anomaly";
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
  const now = new Date();
  // 기본 기간 = 최근 7일(대시보드 배지와 같은 창) — 알림은 오래된 것보다 최신이 중요하다.
  const defFrom = toISODate(new Date(now.getTime() - (ALERT_BADGE_DAYS - 1) * 24 * 60 * 60 * 1000));
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

  const newCount = rows.filter((r) => r.isNew).length;

  return (
    <AppShell user={me} active="security" title="이상 접속" subtitle={me.company.name}>
      <SecurityTabs active="alerts" />
      <AlertsClient
        rows={rows}
        from={fromISO}
        to={toISO}
        todayISO={todayISO}
        capped={capped}
        newCount={newCount}
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
