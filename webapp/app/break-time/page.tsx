// 휴게시간 관리(관리자) — 회사 최소 휴게 기준 설정 + 그날 준수 현황. 판정·표시 전용.
//  · ⚠️ 실근무시간 계산(lib/worktime.ts)은 건드리지 않는다. 휴게 자동 차감 없음(사장님 결정, 2026-07-23).
//  · 휴게시간 = 그날 직원의 외출(Break) 기록 합계. 근무시간 = 기존 workedMinutes 그대로.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { workedMinutes } from "@/lib/worktime";
import { cappedEnd } from "@/lib/overtime";
import { judgeBreak, DEFAULT_BREAK_RULE } from "@/lib/break-rule";
import { toISODate } from "@/lib/period";
import { BreakRuleForm } from "./BreakRuleForm";
import { BreakStatusClient, type BreakRow } from "./BreakStatusClient";

// "YYYY-MM-DD" → 그 날 0시.
//  · 실재하는 날짜인지 확인(2026-99-99가 2034년으로 굴러가는 롤오버 차단), 미래 날짜는 오늘로 자름.
function resolveDay(dateParam: string | undefined): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, dd] = dateParam.split("-").map(Number);
    const parsed = new Date(y, m - 1, dd);
    const real = parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === dd;
    if (real) {
      parsed.setHours(0, 0, 0, 0);
      return parsed.getTime() > today.getTime() ? today : parsed;
    }
  }
  return today;
}

export default async function BreakTimePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const sp = await searchParams;
  const dayStart = resolveDay(sp.date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const now = new Date();

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { breakCheckOn: true, breakMin4h: true, breakMin8h: true },
  });
  const rule = {
    min4h: company?.breakMin4h ?? DEFAULT_BREAK_RULE.min4h,
    min8h: company?.breakMin8h ?? DEFAULT_BREAK_RULE.min8h,
  };
  const checkOn = company?.breakCheckOn ?? true;

  // 그날 출근 기록(회사 격리) + 외출 내역
  const records = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: dayStart, lt: dayEnd } },
    include: {
      breaks: true,
      user: { select: { id: true, name: true, employeeNo: true, role: true, department: { select: { name: true } } } },
    },
    orderBy: { clockIn: "asc" },
  });

  // 같은 날 여러 번 출퇴근한 경우 합산해 하루 단위로 판정한다.
  type Acc = { id: string; name: string; employeeNo: string | null; dept: string; isAdmin: boolean; worked: number; brk: number; open: boolean };
  const byUser = new Map<string, Acc>();
  const isToday = toISODate(dayStart) === toISODate(now);
  for (const r of records) {
    const cur = byUser.get(r.userId) ?? {
      id: r.userId,
      name: r.user.name,
      employeeNo: r.user.employeeNo,
      dept: r.user.department?.name ?? "",
      isAdmin: r.user.role === "admin",
      worked: 0,
      brk: 0,
      open: false,
    };
    // 퇴근을 안 누른 기록은 그날 자정까지만 센다(대시보드 주52·초과근무 관리와 같은 안전장치).
    // 이게 없으면 "어제 퇴근 안 누른 기록"이 20시간 넘게 계산돼 없는 휴게 부족을 만들어낸다.
    const end = cappedEnd(r.clockIn, r.clockOut, now);
    cur.worked += workedMinutes(r, end);
    for (const b of r.breaks) {
      const bEnd = b.endAt ?? end; // 복귀를 안 누른 외출도 같은 상한을 쓴다(휴게가 부풀지 않게)
      cur.brk += Math.max(0, Math.round((bEnd.getTime() - b.startAt.getTime()) / 60000));
    }
    if (!r.clockOut && isToday) cur.open = true; // "근무 중"은 오늘 조회일 때만(과거일의 미퇴근 기록은 근무 중이 아니다)
    byUser.set(r.userId, cur);
  }

  const rows: BreakRow[] = [...byUser.values()]
    .map((u) => {
      const j = judgeBreak(u.worked, u.brk, rule);
      return {
        id: u.id,
        name: u.name,
        employeeNo: u.employeeNo,
        initial: u.name.slice(0, 1),
        dept: u.dept,
        isAdmin: u.isAdmin,
        worked: u.worked,
        actual: j.actual,
        required: j.required,
        shortage: j.shortage,
        status: j.status,
        working: u.open,
        search: [u.name, u.employeeNo ?? "", u.dept].join(" ").toLowerCase(),
      };
    })
    .sort((a, b) => b.shortage - a.shortage || b.worked - a.worked);

  return (
    <AppShell user={me} active="break-time" title="휴게시간 관리" subtitle={`${me.company.name} · 근로기준법 제54조 준수 점검`}>
      <div style={{ marginBottom: 16 }}>
        <BreakRuleForm initial={{ checkOn, min4h: rule.min4h, min8h: rule.min8h }} />
      </div>
      <BreakStatusClient rows={rows} dateISO={toISODate(dayStart)} todayISO={toISODate(now)} checkOn={checkOn} rule={rule} />
    </AppShell>
  );
}
