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

export default async function SettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: {
      officeLat: true, officeLng: true, officeRadiusM: true, officeIps: true,
      workStartTime: true, workEndTime: true, lateGraceMin: true, workDays: true,
      standardWorkHours: true, faceMinPercent: true, livenessPercent: true,
    },
  });

  const currentIp = getClientIp(await headers());

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
          }}
        />
        <OfficeNetworkForm initialIps={company?.officeIps ?? ""} currentIp={currentIp} />
      </div>
      <div className="split-2" style={{ marginBottom: 16 }}>
        <FaceRuleForm initialPercent={company?.faceMinPercent ?? 30} />
        <LivenessRuleForm initialPercent={company?.livenessPercent ?? 50} />
      </div>
      <OfficeLocationForm
        initial={{
          lat: company?.officeLat ?? null,
          lng: company?.officeLng ?? null,
          radius: company?.officeRadiusM ?? 200,
        }}
      />
    </AppShell>
  );
}
