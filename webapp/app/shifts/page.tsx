// 근무표(관리자 전용) — 교대 배정. 회사 격리·관리자만.
//  · 교대 미설정 → 설정 안내. 순환(rotation) → 준비중 안내(Phase 3b). 고정(fixed) → 요일패턴 편집.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { FixedPatternClient } from "./FixedPatternClient";

const Notice = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "20px 22px", fontSize: 14, color: "#1E40AF", lineHeight: 1.7, maxWidth: 640 }}>
    {children}
  </div>
);

export default async function ShiftsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { shiftMode: true, scheduleType: true },
  });
  const shifts = await prisma.shift.findMany({
    where: { companyId: me.companyId },
    orderBy: { order: "asc" },
    select: { id: true, order: true, name: true, startTime: true, endTime: true },
  });

  const shell = (content: React.ReactNode) => (
    <AppShell user={me} active="shifts" title="근무표" subtitle={me.company.name}>{content}</AppShell>
  );

  // 교대 미설정
  if (!company?.shiftMode) {
    return shell(
      <Notice>
        아직 <b>교대근무</b>가 설정되지 않았습니다. <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 700 }}>[설정 → 근무제·기준시간]</Link>에서
        <b> 교대근무(2/3교대)</b>와 조별 시각을 먼저 정한 뒤 여기서 직원을 배정하세요.
      </Notice>
    );
  }
  // 순환(Phase 3b 예정)
  if (company.scheduleType === "rotation") {
    return shell(
      <Notice>
        현재 <b>순환(조가 규칙대로 이동)</b> 방식입니다. 순환 배정 화면(조 A·B·C 배정 + 순환 규칙)은 <b>다음 단계에서 추가</b>됩니다.
        <br />먼저 <b>고정 요일패턴</b>으로 쓰시려면 [설정]에서 근무표 방식을 <b>고정</b>으로 바꿔 주세요.
      </Notice>
    );
  }

  // 고정 요일패턴
  const [employees, patterns] = await Promise.all([
    prisma.user.findMany({
      where: { companyId: me.companyId, role: "employee", deactivatedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, employeeNo: true },
    }),
    prisma.shiftPattern.findMany({
      where: { companyId: me.companyId },
      select: { userId: true, dayOfWeek: true, shiftId: true },
    }),
  ]);
  const patMap: Record<string, string> = {};
  for (const p of patterns) if (p.shiftId) patMap[`${p.userId}_${p.dayOfWeek}`] = p.shiftId;

  return shell(<FixedPatternClient employees={employees} shifts={shifts} initialPatterns={patMap} />);
}
