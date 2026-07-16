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
    // 사내망과 겹치면 그 부분은 실제로 안 막힌다(사내망이 항상 이김) — 관리자에게 정직하게 알린다.
    // 양방향 검사: 규칙이 사내망 안에 있는 경우 + 규칙(대역)이 사내망을 품는 경우 둘 다 잡는다.
    //   예) 사내망 "203.0.113.55", 규칙 "203.0.113"(대역) → 대역 전체를 막은 줄 알지만 사무실만 빠져나간다.
    ineffective:
      ipMatches(b.pattern, company?.officeIps) ||
      (company?.officeIps ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .some((officeIp) => ipMatches(officeIp, b.pattern)),
  }));

  // ── 차단 후보 — 최근 14일 로그인 실패를 IP별로 집계 ─────────────────────
  const since = new Date(Date.now() - CANDIDATE_DAYS * 24 * 60 * 60 * 1000);
  // ⚠️ orderBy 필수: 상한(5000)에 걸릴 때 **최신부터** 담아야 한다. 정렬이 없으면 오래된 것부터 채워져,
  //    정작 밤새 공격이 쏟아진 상황에서 공격 IP가 후보에서 빠지거나 횟수가 실제보다 적게 나온다.
  const fails = await prisma.accessEvent.findMany({
    where: { companyId: me.companyId, kind: "login_fail", createdAt: { gte: since }, ip: { not: null } },
    select: { ip: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5000, // 안전 상한(최근 5000건 기준)
  });

  const agg = new Map<string, { count: number; last: Date }>();
  for (const f of fails) {
    const ip = f.ip!.trim();
    if (!ip) continue; // 빈 문자열 IP는 후보가 될 수 없다(ip: {not: null}은 ""를 막지 못함)
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
