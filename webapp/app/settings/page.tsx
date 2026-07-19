// 설정 (관리자 전용) — 사업장 위치 등.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/ip";
import { AppShell } from "@/app/components/AppShell";
import { WorkRulesForm } from "./WorkRulesForm";
import { OfficeLocationForm } from "./OfficeLocationForm";
import { OfficeNetworkForm } from "./OfficeNetworkForm";
import { FaceRuleForm } from "./FaceRuleForm";
import { LivenessRuleForm } from "./LivenessRuleForm";
import { AlertRulesForm } from "./AlertRulesForm";
import { HolidayForm } from "./HolidayForm";

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: {
      officeLat: true, officeLng: true, officeRadiusM: true, officeIps: true,
      officeAddress: true, officeAddressDetail: true,
      workStartTime: true, workEndTime: true, lateGraceMin: true, workDays: true,
      standardWorkHours: true, overtimeAlertOn: true, overtimeWarnHours: true,
      faceMinPercent: true, faceMinBrightness: true, livenessPercent: true,
      alertNightOn: true, alertNightStart: true, alertNightEnd: true, alertFailOn: true, alertFailCount: true,
      holidayAutoOn: true,
      shiftMode: true, scheduleType: true,
    },
  });

  // 교대조 정의(있으면) — 근무제 폼에서 조별 시각을 보여준다.
  const shifts = await prisma.shift.findMany({
    where: { companyId: me.companyId },
    orderBy: { order: "asc" },
    select: { order: true, name: true, startTime: true, endTime: true },
  });

  const currentIp = getClientIp(await headers());

  // 공휴일·휴무일 설정용 데이터: 회사 수동 휴무일 목록 + 저장된 전국 공휴일 요약(건수·연도).
  const [companyHolidays, holidayYears] = await Promise.all([
    prisma.companyHoliday.findMany({
      where: { companyId: me.companyId },
      select: { id: true, date: true, name: true },
      orderBy: { date: "asc" },
    }),
    prisma.holiday.findMany({ select: { year: true }, distinct: ["year"], orderBy: { year: "asc" } }),
  ]);
  const syncedCount = await prisma.holiday.count();
  const syncedYears = holidayYears.map((h) => `${h.year}년`).join("·");

  return (
    <AppShell user={me} active="settings" title="설정" subtitle={`${me.company.name} · 관리자 ${me.name}`}>
      {/* PC=2단(근무제 | 사내 네트워크), 좁은 화면=세로. 지도는 전체 폭 */}
      <div className="split-2" style={{ marginBottom: 16 }}>
        <WorkRulesForm
          initial={{
            start: company?.workStartTime ?? "",
            end: company?.workEndTime ?? "",
            grace: company?.lateGraceMin ?? 0,
            workDays: company?.workDays ?? "1,2,3,4,5",
            standardHours: company?.standardWorkHours ?? 8,
            overtimeAlertOn: company?.overtimeAlertOn ?? true,
            overtimeWarnHours: company?.overtimeWarnHours ?? 48,
            shiftMode: company?.shiftMode ?? 0,
            scheduleType: company?.scheduleType ?? "fixed",
            shifts,
          }}
        />
        <OfficeNetworkForm initialIps={company?.officeIps ?? ""} currentIp={currentIp} />
      </div>
      <div className="split-2" style={{ marginBottom: 16 }}>
        <FaceRuleForm initialPercent={company?.faceMinPercent ?? 30} initialBrightness={company?.faceMinBrightness ?? 0} />
        <LivenessRuleForm initialPercent={company?.livenessPercent ?? 50} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <AlertRulesForm
          initial={{
            nightOn: company?.alertNightOn ?? true,
            nightStart: company?.alertNightStart ?? 22,
            nightEnd: company?.alertNightEnd ?? 6,
            failOn: company?.alertFailOn ?? true,
            failCount: company?.alertFailCount ?? 5,
          }}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <HolidayForm
          initial={{
            autoOn: company?.holidayAutoOn ?? true,
            holidays: companyHolidays,
            syncedCount,
            syncedYears,
          }}
        />
      </div>
      <OfficeLocationForm
        initial={{
          lat: company?.officeLat ?? null,
          lng: company?.officeLng ?? null,
          radius: company?.officeRadiusM ?? 200,
          address: company?.officeAddress ?? null,
          addressDetail: company?.officeAddressDetail ?? null,
        }}
      />
    </AppShell>
  );
}
