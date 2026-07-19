// 로그인 이력(관리자 전용) — 로그인·로그인실패·로그아웃 접속 기록을 기간·검색으로 조회.
//  · 데이터: AccessEvent(kind = login/login_fail/logout). 회사 격리(companyId = 내 회사).
//  · 기간: createdAt 기준(기본 이번 달). 성능 위해 최대 92일로 제한.
//  · 존재하지 않는 이메일의 로그인 실패는 companyId가 없어 여기 안 보인다(테넌트 안전).
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { toISODate } from "@/lib/period";
import { accessKindLabel, accessResultLabel, accessMetaLabel } from "@/lib/access-labels";
import { purgeExpiredAccessEvents } from "@/lib/access-log";
import { SecurityTabs } from "@/app/security/SecurityTabs";
import { LoginHistoryClient, type LoginRow } from "./LoginHistoryClient";

const AUTH_KINDS = ["login", "login_fail", "logout"];

// Date → "MM-DD HH:MM"
function fmtDateTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export default async function LoginHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  // 접속기록 2년 자동 파기의 정기 트리거 — 관리자가 보안 화면을 열 때(하루 1회만 실제 동작),
  // 화면 응답을 보낸 뒤(after) 실행되어 조회 속도에 영향 없음.
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

  const events = await prisma.accessEvent.findMany({
    where: { companyId: me.companyId, kind: { in: AUTH_KINDS }, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "desc" },
    take: 2000, // 안전 상한(초과분은 기간을 좁혀 보게 안내)
  });

  // 접속기록엔 사번이 없다(이벤트 시점 이름만 스냅샷) → 행위자 userId로 현재 직원의 사번을 찾아 붙인다.
  //   (로그인 실패 등 userId 없는 기록·삭제/미상 계정은 사번 없음 → 화면 "—")
  const eventUserIds = [...new Set(events.map((e) => e.userId).filter((x): x is string => !!x))];
  const empNoUsers = eventUserIds.length
    ? await prisma.user.findMany({ where: { companyId: me.companyId, id: { in: eventUserIds } }, select: { id: true, employeeNo: true } })
    : [];
  const empNoById = new Map(empNoUsers.map((u) => [u.id, u.employeeNo]));

  const rows: LoginRow[] = events.map((e) => {
    const name = e.actorName ?? e.emailTried ?? "알 수 없음";
    const employeeNo = e.userId ? empNoById.get(e.userId) ?? null : null;
    const kindLabel = accessKindLabel(e.kind);
    const resultLabel = accessResultLabel(e.result);
    const metaLabel = accessMetaLabel(e.meta);
    const timeText = fmtDateTime(e.createdAt);
    return {
      id: e.id,
      timeText,
      name,
      employeeNo,
      email: e.emailTried ?? "",
      kind: e.kind,
      kindLabel,
      device: e.device ?? "—",
      ip: e.ip ?? "—",
      result: e.result,
      resultLabel,
      metaLabel,
      search: [name, employeeNo ?? "", e.emailTried ?? "", kindLabel, e.device ?? "", e.ip ?? "", resultLabel, metaLabel].join(" ").toLowerCase(),
    };
  });

  const exportBase = `/security/logins/export?from=${fromISO}&to=${toISO}`;

  return (
    <AppShell user={me} active="security" title="로그인 이력" subtitle={me.company.name}>
      <SecurityTabs active="logins" />
      <LoginHistoryClient rows={rows} from={fromISO} to={toISO} todayISO={todayISO} exportBase={exportBase} capped={events.length >= 2000} />
    </AppShell>
  );
}
