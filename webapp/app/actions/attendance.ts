"use server";
// 출퇴근 — 로그인한 본인의 출근/퇴근을 기록한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { evaluateOfficeLocation } from "@/lib/location";
import { getClientIp, ipMatches } from "@/lib/ip";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

// 출근 — 근무형태(사무실/재택/외근)와, 사무실이면 현재 좌표를 받는다.
// 사무실만 위치 확인. 재택·외근은 위치 확인 없음. 위치가 벗어나도 출근은 막지 않는다(부드럽게).
// 프라이버시: 좌표 원본은 저장하지 않고 확인 결과만 저장한다.
export async function clockIn(
  mode: "office" | "home" | "field" = "office",
  lat?: number,
  lng?: number
): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  // 이미 근무 중이면 중복 생성 안 함
  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
  });
  if (open) {
    revalidatePath("/attendance");
    return;
  }

  let locationStatus: string | null = null;
  if (mode === "office") {
    const company = await prisma.company.findUnique({
      where: { id: me.companyId },
      select: { officeLat: true, officeLng: true, officeRadiusM: true, officeIps: true },
    });

    // ① GPS 확인(휴대폰) ② 사내 IP 확인(PC) — 둘 중 하나만 맞아도 확인됨.
    const gps = company ? evaluateOfficeLocation(company, lat, lng) : "unavailable";
    const h = await headers();
    const clientIp = getClientIp(h);
    const hasIpRule = Boolean(company?.officeIps && company.officeIps.trim());
    const ipMatch = hasIpRule && ipMatches(clientIp, company?.officeIps);

    if (ipMatch || gps === "verified") {
      locationStatus = "verified";
    } else if (gps === "out_of_range" || hasIpRule) {
      // 확인 수단이 있었는데(GPS 범위 밖이거나 IP 규칙 존재) 못 맞춘 경우
      locationStatus = "out_of_range";
    } else {
      locationStatus = "unavailable";
    }
  }

  await prisma.attendance.create({
    data: { userId: me.id, companyId: me.companyId, workMode: mode, locationStatus },
  });

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// 퇴근 — 열려있는(퇴근 안 한) 가장 최근 출근 기록에 퇴근 시각을 채운다.
// 외출 중에 퇴근을 누르면 외출도 함께 종료한다.
export async function clockOut(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (open) {
    const now = new Date();
    // 열린 외출이 있으면 먼저 복귀 처리
    await prisma.break.updateMany({
      where: { attendanceId: open.id, endAt: null },
      data: { endAt: now },
    });
    await prisma.attendance.update({
      where: { id: open.id },
      data: { clockOut: now },
    });
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// 외출 시작 — 근무 중(출근했고 외출 안 한 상태)일 때만. 사유는 드롭다운에서 받는다.
export async function startBreak(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const reason = String(formData.get("reason") ?? "기타");

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open) return; // 출근 상태가 아니면 무시

  // 이미 외출 중이면 중복 생성 안 함
  const openBreak = await prisma.break.findFirst({
    where: { attendanceId: open.id, endAt: null },
  });
  if (!openBreak) {
    await prisma.break.create({ data: { attendanceId: open.id, reason } });
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// 복귀 — 열려있는 외출을 종료한다.
export async function endBreak(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open) return;

  await prisma.break.updateMany({
    where: { attendanceId: open.id, endAt: null },
    data: { endAt: new Date() },
  });

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}
