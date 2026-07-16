// 접속 로그(관리자 전용) — 로그인·출퇴근·관리자 동작을 IP·기기 중심으로 조회.
//  · 데이터: AccessEvent(로그인/실패/로그아웃/출근/퇴근/설정변경/생체정보 파기). 회사 격리(companyId = 내 회사).
//  · 사내망/외부 판정: 회사 허용 IP(officeIps)와 대조 — 출퇴근 위치확인과 동일한 ipMatches 규칙 사용(무수정 재사용).
//  · 기간: createdAt 기준(기본 이번 달), 성능 위해 최대 92일 — 로그인 이력 화면과 동일 규칙.
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { toISODate } from "@/lib/period";
import { ipMatches } from "@/lib/ip";
import { accessKindLabel, accessResultLabel, accessMetaLabel } from "@/lib/access-labels";
import { purgeExpiredAccessEvents } from "@/lib/access-log";
import { SecurityTabs } from "@/app/security/SecurityTabs";
import { AccessLogClient, type AccessRow } from "./AccessLogClient";

// 이 화면에서 다루는 종류 — 로그인 계열 + 출퇴근(3단계) + 관리자 동작(4단계) + 차단 거부(5단계).
// ⚠️ 새 kind를 기록하기 시작하면 **반드시 여기와 export/route.ts의 KIND_GROUPS·화면 필터에 함께 추가**할 것.
//    빠뜨리면 DB엔 쌓이는데 화면·엑셀 어디에도 안 보이고 2년 뒤 조용히 파기된다(5단계에서 실제로 겪음).
const ACCESS_KINDS = ["login", "login_fail", "logout", "clock_in", "clock_out", "config", "purge", "blocked"];

// Date → "MM-DD HH:MM"
function fmtDateTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export default async function AccessLogPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 접속기록 2년 자동 파기의 정기 트리거 — 관리자가 이 화면을 열 때(하루 1회만 실제 동작),
  // 화면 응답을 보낸 뒤(after) 실행되어 조회 속도에 영향 없음. (사진 90일 파기와 동일 방식)
  after(() => purgeExpiredAccessEvents());

  const sp = await searchParams;
  const todayISO = toISODate(new Date());
  const now = new Date();
  const defFrom = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
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
  // 과도한 전량 로드 방지: 최대 92일(초과 시 잘라 표시 종료일도 맞춤)
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + 92);
  if (end > maxEnd) {
    end = maxEnd;
    const capEnd = new Date(maxEnd);
    capEnd.setDate(capEnd.getDate() - 1);
    toISO = toISODate(capEnd);
  }

  // 사내망 판정 기준 = 회사 허용 IP 목록(설정 화면에서 관리). 규칙이 없으면 판정 불가로 표시.
  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { officeIps: true },
  });
  const hasIpRule = Boolean(company?.officeIps && company.officeIps.trim());

  const events = await prisma.accessEvent.findMany({
    where: { companyId: me.companyId, kind: { in: ACCESS_KINDS }, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "desc" },
    take: 2000, // 안전 상한(초과분은 기간을 좁혀 보게 안내)
  });

  const rows: AccessRow[] = events.map((e) => {
    const name = e.actorName ?? e.emailTried ?? "알 수 없음";
    const kindLabel = accessKindLabel(e.kind);
    const resultLabel = accessResultLabel(e.result);
    const metaLabel = accessMetaLabel(e.meta);
    // 사내망/외부 — 회사 허용 IP 규칙이 있을 때만 판정한다(없으면 "판정 불가", 지어내지 않음).
    const net: AccessRow["net"] = !hasIpRule || !e.ip ? "unknown" : ipMatches(e.ip, company?.officeIps) ? "office" : "outside";
    const netLabel = net === "office" ? "사내망" : net === "outside" ? "외부" : "판정 불가";
    return {
      id: e.id,
      timeText: fmtDateTime(e.createdAt),
      name,
      email: e.emailTried ?? "",
      kind: e.kind,
      kindLabel,
      device: e.device ?? "—",
      ip: e.ip ?? "—",
      net,
      netLabel,
      result: e.result,
      resultLabel,
      metaLabel,
      search: [name, e.emailTried ?? "", kindLabel, e.device ?? "", e.ip ?? "", netLabel, resultLabel, metaLabel]
        .join(" ")
        .toLowerCase(),
    };
  });

  const exportBase = `/security/access/export?from=${fromISO}&to=${toISO}`;

  return (
    <AppShell user={me} active="security" title="접속 로그" subtitle={me.company.name}>
      <SecurityTabs active="access" />
      <AccessLogClient
        rows={rows}
        from={fromISO}
        to={toISO}
        todayISO={todayISO}
        exportBase={exportBase}
        capped={events.length >= 2000}
        hasIpRule={hasIpRule}
      />
    </AppShell>
  );
}
