// 실시간 현황판(관리자 전용) — 사무실 지도 + 지금 근무 중 + 오늘 접속(사내망/외부).
//  · 회사 격리(companyId = 내 회사). 관리자만.
//  · 지도에 찍는 유일한 진짜 좌표 = 사무실. 직원 개인 위치는 저장하지 않으므로 지도에 안 찍는다.
//  · "지금 근무 중" = 출퇴근 기록(출근했고 아직 퇴근 안 함) — 대시보드와 같은 계산. 진짜 데이터.
//  · "오늘 접속" = 오늘 있었던 접속 집계(지금 접속 중인 인원이 아님 — 하트비트 미추적, 오해 금지).
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/app/components/AppShell";
import { ipMatches } from "@/lib/ip";
import { locationStatusLabel } from "@/lib/location";
import { LiveClient, type LiveData, type WorkingPerson } from "./LiveClient";

function hhmm(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default async function LivePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/attendance");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: {
      officeLat: true, officeLng: true, officeRadiusM: true,
      officeIps: true, officeAddress: true, officeAddressDetail: true,
    },
  });

  // 오늘 출근 기록(근무 중 판단용) — 재직 직원 이름은 user에서.
  const todays = await prisma.attendance.findMany({
    where: { companyId: me.companyId, clockIn: { gte: startOfToday } },
    include: { user: { select: { name: true, authMethod: true } } },
    orderBy: { clockIn: "asc" },
  });

  // 지금 근무 중 = 출근했고 아직 퇴근 안 한 사람. 근무형태별로 나눈다.
  const buckets: Record<"office" | "home" | "field", WorkingPerson[]> = { office: [], home: [], field: [] };
  for (const r of todays) {
    if (r.clockOut) continue; // 퇴근함 = 근무 중 아님
    const mode = (r.workMode === "home" || r.workMode === "field" ? r.workMode : "office") as "office" | "home" | "field";
    buckets[mode].push({
      name: r.user.name,
      since: hhmm(r.clockIn),
      // 사무실 근무자만 위치확인 상태를 함께 보여준다(재택·외근은 위치확인 안 함).
      locationLabel: mode === "office" && r.locationStatus ? locationStatusLabel(r.locationStatus) : null,
      locationOk: r.locationStatus === "verified",
      authLabel: r.user.authMethod === "face" ? "얼굴인증" : r.user.authMethod === "gps" ? "GPS" : "—",
    });
  }
  const workingTotal = buckets.office.length + buckets.home.length + buckets.field.length;

  // 오늘 접속 집계 — 로그인·출퇴근 접속을 사내망/외부로 나눈다(officeIps 있을 때만 판정).
  const hasIpRule = Boolean(company?.officeIps && company.officeIps.trim());
  // take는 상한(안전장치). 초과하면 조용히 잘려 숫자가 실제보다 작아지므로 잘림 여부를 함께 내려보낸다.
  // (사무직 하루 수천 건은 현실적으로 드물지만, 잘렸다면 화면에 "+"로 정직하게 알린다 — 6단계와 같은 원칙)
  const ACCESS_CAP = 5000;
  const accessEvents = await prisma.accessEvent.findMany({
    where: {
      companyId: me.companyId,
      kind: { in: ["login", "clock_in", "clock_out"] },
      result: "success",
      createdAt: { gte: startOfToday },
      ip: { not: null },
    },
    select: { ip: true },
    take: ACCESS_CAP + 1, // +1로 "정확히 상한"과 "잘림"을 구분
  });
  const accessCapped = accessEvents.length > ACCESS_CAP;
  if (accessCapped) accessEvents.length = ACCESS_CAP;
  let officeCount = 0, outsideCount = 0, unknownCount = 0;
  for (const e of accessEvents) {
    const ip = (e.ip ?? "").trim();
    if (!hasIpRule || !ip) unknownCount++;
    else if (ipMatches(ip, company?.officeIps)) officeCount++;
    else outsideCount++;
  }

  const data: LiveData = {
    office: company?.officeLat != null && company?.officeLng != null
      ? {
          lat: company.officeLat,
          lng: company.officeLng,
          radius: company.officeRadiusM,
          address: [company.officeAddress, company.officeAddressDetail].filter(Boolean).join(" ") || null,
        }
      : null,
    working: buckets,
    workingTotal,
    access: { office: officeCount, outside: outsideCount, unknown: unknownCount, hasIpRule, capped: accessCapped },
    generatedAt: hhmm(new Date()),
  };

  return (
    <AppShell user={me} active="live" title="실시간 현황판" subtitle={me.company.name}>
      <LiveClient data={data} />
    </AppShell>
  );
}
