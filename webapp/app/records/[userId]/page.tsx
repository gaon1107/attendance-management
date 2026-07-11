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
import { leaveLabelByDate } from "@/lib/leave";
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
    include: {
      breaks: true,
      // 출퇴근 촬영 사진·판독 기록(관리자 전용 "본인 확인" 열) — 파일 이름 등 내부 정보는 내리지 않는다
      clockPhotos: {
        select: { id: true, kind: true, livenessStatus: true, livenessScore: true, fileDeletedAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { clockIn: "desc" },
  });

  // 이 기간에 걸치는 승인된 이 직원의 휴가 → 날짜별 라벨(결근 대신 "휴가")
  const leaves = await prisma.leaveRequest.findMany({
    where: { userId: target.id, companyId: me.companyId, status: "approved", startDate: { lt: end }, endDate: { gte: start } },
    select: { type: true, startDate: true, endDate: true },
  });
  const leaveByDate = leaveLabelByDate(leaves);

  const detail = buildDayEntries(rows, target.workDays, company, start, end, leaveByDate);

  const backBtn = (
    <Link href="/records" style={{ height: 38, padding: "0 14px", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text-sub)", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
      ← 근태 현황
    </Link>
  );

  return (
    <AppShell user={me} active="records" title={`${target.name} 님 근태 상세`} subtitle={me.company.name} right={backBtn}>
      <PeriodNav basePath={`/records/${target.id}`} unit={unit} anchor={anchor} label={label} />
      {/* 관리자 화면에만 "본인 확인"(판독·사진) 열을 켠다 — 직원 본인 화면(my-records)은 기존 그대로 */}
      <DetailTable detail={detail} showLiveness />
    </AppShell>
  );
}
