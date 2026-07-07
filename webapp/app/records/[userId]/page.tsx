// 직원별 근태 상세 — 관리자 전용. 기간 내 날짜별 출퇴근/외출/실근무/지각 + 결근·휴일근무. (리뉴얼 디자인)
// ※ 회사 격리: userId가 내 회사 소속이 아니면 보여주지 않는다(notFound).
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { PeriodNav } from "@/app/components/PeriodNav";
import { DetailTable } from "@/app/components/DetailTable";
import { buildDayEntries } from "@/lib/dayentries";
import { normalizeUnit, parseAnchor, rangeFor } from "@/lib/period";

export default async function RecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ unit?: string; date?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const { userId } = await params;
  // 회사 격리 — 반드시 내 회사 소속 직원만 조회
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: me.companyId } });
  if (!target) notFound();

  const sp = await searchParams;
  const unit = normalizeUnit(sp.unit);
  const anchor = parseAnchor(sp.date);
  const { start, end, label } = rangeFor(unit, anchor);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { workStartTime: true, lateGraceMin: true, workDays: true },
  });

  const rows = await prisma.attendance.findMany({
    where: { userId: target.id, companyId: me.companyId, clockIn: { gte: start, lt: end } },
    include: { breaks: true },
    orderBy: { clockIn: "desc" },
  });

  const detail = buildDayEntries(rows, target.workDays, company, start, end);

  const backBtn = (
    <Link href="/records" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 근태 현황
    </Link>
  );

  return (
    <AppShell user={me} active="records" title={`${target.name} 님 근태 상세`} subtitle={me.company.name} right={backBtn}>
      <PeriodNav basePath={`/records/${target.id}`} unit={unit} anchor={anchor} label={label} />
      <DetailTable detail={detail} />
    </AppShell>
  );
}
