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
import { OutingReasonForm } from "./OutingReasonForm";
import { FaceRuleForm } from "./FaceRuleForm";
import { LivenessRuleForm } from "./LivenessRuleForm";
import { AlertRulesForm } from "./AlertRulesForm";
import { HolidayForm } from "./HolidayForm";
import { PcOffForm } from "./PcOffForm";
import { SettingsTabs, resolveTab } from "./SettingsTabs";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // 어느 탭을 보고 있는지. 모르는 값이 들어오면 첫 탭으로 되돌린다(주소를 손으로 고쳐도 안전).
  const tab = resolveTab((await searchParams).tab);
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
      outingReasons: true,
      // PC-OFF(근무시간 외 PC 잠금) 설정 — 기본값이 있어 기존 회사도 그대로 읽힌다.
      pcOffOn: true, pcOffMode: true, pcOffDelayMin: true, pcOffNotifyMins: true,
      pcOffTempUseMin: true, pcOffTempUsePerDay: true, pcOffTempReasons: true,
    },
  });

  // PC-OFF 카드에 보여줄 "지금 연결된 PC 수"(해제되지 않은 기기만). 가짜 숫자를 쓰지 않기 위해 실제로 센다.
  const pcDeviceCount = await prisma.agentDevice.count({
    where: { companyId: me.companyId, revokedAt: null },
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
      {/* 2026-08-23: 설정 9개가 한 페이지에 4,600px로 쌓여 있고 [저장]이 9개라 헷갈렸다 → 탭 3개로 나눴다.
          ⚠️ 각 폼에 넘기는 값은 **하나도 바꾸지 않았다.** 저장 기능이 그 값에 걸려 있어, 여기서 손대면
             "저장했는데 저장 안 되는" 조용한 고장이 난다. 위치만 옮겼다.
          ⚠️ 데이터 조회(위 prisma)는 탭과 무관하게 **전부 그대로** 한다. 탭별로 나누면 코드가 복잡해지고,
             탭을 옮길 때마다 조회가 달라져 값이 어긋날 수 있다. */}
      <SettingsTabs active={tab} />

      {tab === "work" && (
        <>
          {/* PC=2단(근무제 | 공휴일), 좁은 화면=세로 */}
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
<HolidayForm
          initial={{
            autoOn: company?.holidayAutoOn ?? true,
            holidays: companyHolidays,
            syncedCount,
            syncedYears,
          }}
        />
          </div>
          <div style={{ marginBottom: 16 }}>
<OutingReasonForm initialReasons={company?.outingReasons ?? ""} />
          </div>
        </>
      )}

      {tab === "auth" && (
        <>
          {/* PC=2단(얼굴 기준 | 재검토 기준), 좁은 화면=세로. 지도는 전체 폭 */}
          <div className="split-2" style={{ marginBottom: 16 }}>
<FaceRuleForm initialPercent={company?.faceMinPercent ?? 30} initialBrightness={company?.faceMinBrightness ?? 0} />
<LivenessRuleForm initialPercent={company?.livenessPercent ?? 50} />
          </div>
          <div style={{ marginBottom: 16 }}>
<OfficeNetworkForm initialIps={company?.officeIps ?? ""} currentIp={currentIp} />
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
        </>
      )}

      {tab === "security" && (
        <>
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
          </div>
          <div style={{ marginBottom: 16 }}>
<PcOffForm
          initial={{
            on: company?.pcOffOn ?? false,
            mode: company?.pcOffMode ?? "lock",
            delayMin: company?.pcOffDelayMin ?? 10,
            notifyMins: company?.pcOffNotifyMins ?? "10,5",
            tempUseMin: company?.pcOffTempUseMin ?? 30,
            tempUsePerDay: company?.pcOffTempUsePerDay ?? 2,
            tempReasons: company?.pcOffTempReasons ?? "",
            workEndTime: company?.workEndTime ?? null,
            deviceCount: pcDeviceCount,
            isShiftCompany: !!company?.shiftMode,
          }}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
          </div>
        </>
      )}
    </AppShell>
  );
}
