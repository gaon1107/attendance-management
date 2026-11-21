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
import { CompanySmsForm } from "./CompanySmsForm";
import { SettingsTabs, SettingsTabHint, resolveTab } from "./SettingsTabs";
import { getCompanySmsAccountStatus } from "@/lib/company-sms-account";

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

  // [문자·알림톡] 탭 데이터 — **이 탭을 열 때만** 읽는다(위 "조회는 탭과 무관하게 전부" 원칙의 예외).
  //  · 상태를 만들려면 저장된 비밀번호를 한 번 풀어 봐야 하는데, 서버 키가 없거나 바뀌었으면 풀 때마다 서버 로그에
  //    오류가 찍힌다. 다른 탭을 볼 때마다 그 오류가 쌓이면 진짜 문제를 가린다.
  //  · ⚠️ 비밀번호 값은 상태에 담기지 않는다(lib/company-sms-account.ts) — 화면으로 나가는 건 "저장됨/쓸 수 있음"뿐.
  const smsStatus = tab === "message" ? await getCompanySmsAccountStatus(me.companyId) : null;
  const myPhone =
    tab === "message"
      ? (await prisma.user.findUnique({ where: { id: me.id }, select: { phone: true } }))?.phone ?? ""
      : "";

  return (
    <AppShell user={me} active="settings" title="설정" subtitle={`${me.company.name} · 관리자 ${me.name}`}>
      {/* 2026-08-23: 설정 9개가 한 페이지에 4,600px로 쌓여 있고 [저장]이 9개라 헷갈렸다 → 탭 3개로 나눴다.
          ⚠️ 각 폼에 넘기는 값은 **하나도 바꾸지 않았다.** 저장 기능이 그 값에 걸려 있어, 여기서 손대면
             "저장했는데 저장 안 되는" 조용한 고장이 난다. 위치만 옮겼다.
          ⚠️ 데이터 조회(위 prisma)는 탭과 무관하게 **전부 그대로** 한다. 탭별로 나누면 코드가 복잡해지고,
             탭을 옮길 때마다 조회가 달라져 값이 어긋날 수 있다. */}
      <SettingsTabs active={tab} />
      <SettingsTabHint active={tab} />

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
        </>
      )}

      {tab === "message" && smsStatus && (
        <CompanySmsForm
          status={{
            smsId: smsStatus.smsId,
            sender: smsStatus.sender,
            passwordSaved: smsStatus.passwordSaved,
            passwordUsable: smsStatus.passwordUsable,
            keyReady: smsStatus.keyReady,
            connected: smsStatus.connected,
            // 서버 시간대(Asia/Seoul) 기준으로 글자로 만들어 넘긴다 — 날짜 객체를 그대로 넘기면 화면 쪽 시간대로 바뀐다.
            updatedLabel: smsStatus.updatedAt
              ? smsStatus.updatedAt.toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                })
              : null,
          }}
          myPhone={myPhone}
        />
      )}
    </AppShell>
  );
}
