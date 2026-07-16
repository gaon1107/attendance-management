// 차단 IP 관리(관리자 전용) — 명단에 올린 IP는 로그인이 거부된다(접속/보안 5단계).
//  · 회사 격리(companyId = 내 회사). 관리자만.
//  · 차단 후보: 최근 14일 로그인 실패가 많은 IP를 "수상함"으로 보여주기만 한다(사장님 결정 2026-07-16).
//    자동으로 막지 않는 이유 — 사무실은 직원 전원이 같은 공인 IP를 쓰는 경우가 많아, 한 명의 비번 실수로
//    회사 전체가 로그인 못 하는 사고가 난다. 막을지는 사람이 판단한다.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { AppShell } from "@/app/components/AppShell";
import { getClientIp, ipMatches } from "@/lib/ip";
import { SecurityTabs } from "@/app/security/SecurityTabs";
import { BlockedIpClient, type BlockedRow, type CandidateRow } from "./BlockedIpClient";

// 차단 후보 집계 기간·기준
const CANDIDATE_DAYS = 14;
const CANDIDATE_MIN_FAILS = 3; // 이 횟수 이상 실패한 IP만 후보로 표시

export default async function BlockedIpPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const myIp = getClientIp(await headers());

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { officeIps: true },
  });

  const blocks = await prisma.blockedIp.findMany({
    where: { companyId: me.companyId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows: BlockedRow[] = blocks.map((b) => ({
    id: b.id,
    pattern: b.pattern,
    reason: b.reason ?? "",
    createdBy: b.createdBy ?? "—",
    createdAt: b.createdAt.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }),
    // 사내망이면 이 규칙은 실제로는 효력이 없다(사내망이 항상 이김) — 관리자에게 정직하게 알린다.
    ineffective: ipMatches(b.pattern, company?.officeIps),
  }));

  // ── 차단 후보 — 최근 14일 로그인 실패를 IP별로 집계 ─────────────────────
  const since = new Date(Date.now() - CANDIDATE_DAYS * 24 * 60 * 60 * 1000);
  const fails = await prisma.accessEvent.findMany({
    where: { companyId: me.companyId, kind: "login_fail", createdAt: { gte: since }, ip: { not: null } },
    select: { ip: true, createdAt: true },
    take: 5000, // 안전 상한
  });

  const agg = new Map<string, { count: number; last: Date }>();
  for (const f of fails) {
    const ip = f.ip!;
    const cur = agg.get(ip);
    if (!cur) agg.set(ip, { count: 1, last: f.createdAt });
    else {
      cur.count += 1;
      if (f.createdAt > cur.last) cur.last = f.createdAt;
    }
  }

  const blockedPatterns = blocks.map((b) => ({ pattern: b.pattern }));
  const candidates: CandidateRow[] = [...agg.entries()]
    .filter(([ip, v]) => {
      if (v.count < CANDIDATE_MIN_FAILS) return false;
      if (ipMatches(ip, company?.officeIps)) return false; // 사내망은 후보에서 제외(막아도 효력 없음)
      if (blockedPatterns.some((b) => ipMatches(ip, b.pattern))) return false; // 이미 차단된 건 제외
      return true;
    })
    .map(([ip, v]) => ({
      ip,
      count: v.count,
      last: v.last.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }),
      isMine: Boolean(myIp && ip === myIp), // 내 IP면 차단 버튼을 막는다(자기잠금 방어)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return (
    <AppShell user={me} active="security" title="차단 IP" subtitle={me.company.name}>
      <SecurityTabs active="blocked" />
      <BlockedIpClient
        rows={rows}
        candidates={candidates}
        myIp={myIp ?? "확인 불가"}
        hasOfficeIps={Boolean(company?.officeIps && company.officeIps.trim())}
        candidateDays={CANDIDATE_DAYS}
      />
    </AppShell>
  );
}
