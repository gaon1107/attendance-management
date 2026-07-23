"use server";
// 출퇴근 — 로그인한 본인의 출근/퇴근을 기록한다.
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { evaluateOfficeLocation } from "@/lib/location";
import { getClientIp, ipMatches } from "@/lib/ip";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { recordAccess, readClientMeta } from "@/lib/access-log";
import { parseOutingReasons } from "@/lib/outing-reasons";

// [접속기록 — add-only] 출퇴근이 "실제로 처리된 뒤"에만 접속 IP·기기를 남긴다(보안 화면 3단계).
//  · 출퇴근 판정·중복방지 로직은 일절 건드리지 않는다. 이 함수는 맨 끝에서만 호출된다.
//  · after()로 응답을 보낸 뒤 실행 + recordAccess 자체가 try/catch → 기록이 실패해도 출퇴근은 정상.
//  · clockIn/clockOut 안에 두는 이유: 일반 버튼·얼굴 출퇴근 등 호출처 4곳을 자동으로 커버하고 중복도 없다.
async function logClockAccess(
  me: { id: string; companyId: string; name: string },
  kind: "clock_in" | "clock_out",
  meta?: string | null
): Promise<void> {
  // ⚠️ 전체를 try/catch로 감싼다: recordAccess 안쪽뿐 아니라 headers()·after() 호출 자체가 실패해도
  //    출퇴근이 에러화면으로 끝나면 안 된다(DB엔 출근이 남았는데 사용자는 실패로 오해 → 재클릭 시 조용히 무시됨).
  try {
    // 헤더는 after 밖에서 미리 읽는다(Next 16: 서버액션은 안에서도 되지만, 페이지와 규칙을 통일).
    const { ip, userAgent } = readClientMeta(await headers());
    after(() =>
      recordAccess({
        companyId: me.companyId,
        userId: me.id,
        actorName: me.name,
        kind,
        result: "success",
        ip,
        userAgent,
        meta: meta ?? null,
      })
    );
  } catch (e) {
    console.warn("[access-log] 출퇴근 접속기록 등록 실패(출퇴근은 정상 처리됨):", e);
  }
}

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

  // [접속기록] 출근이 실제로 생성된 경우에만(위 중복 클릭은 이미 return됨). meta=근무형태.
  await logClockAccess(me, "clock_in", mode);
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

  // [접속기록] 실제로 퇴근 처리된 경우에만(열린 출근 기록이 있었을 때).
  if (open) await logClockAccess(me, "clock_out", open.workMode);
}

// 외출 시작 — 근무 중(출근했고 외출 안 한 상태)일 때만. 사유는 드롭다운에서 받는다.
export async function startBreak(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;

  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open) return; // 출근 상태가 아니면 무시

  // 사유는 회사가 설정한 목록(미설정이면 기본 4종) 안에서만 받는다 — 폼 위조로 임의 문자열이 저장되는 것 차단(B-6).
  // 목록 밖이면 외출 기록 자체를 버리지 않고(=실근무시간 과다계산 방지) 뜻이 가장 덜 왜곡되는 "기타"로 저장한다.
  const company = await prisma.company.findUnique({
    where: { id: me.companyId },
    select: { outingReasons: true },
  });
  const allowed = parseOutingReasons(company?.outingReasons);
  const picked = String(formData.get("reason") ?? "");
  let reason = picked;
  if (!allowed.includes(picked)) {
    // 관리자가 방금 목록을 바꿔 직원의 열린 화면이 옛 목록인 경우 등. 조용히 넘기지 않고 흔적을 남긴다.
    reason = allowed.includes("기타") ? "기타" : allowed[0];
    console.warn(`[startBreak] 목록 밖 사유 "${picked}" → "${reason}"로 대체 (company=${me.companyId})`);
  }

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
