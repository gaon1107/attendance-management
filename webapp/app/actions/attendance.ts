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
import { openSessionSince } from "@/lib/worktime";

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

// ── [검수 C-4] "지금 근무 중"으로 볼 열린 출근 기록의 시간 범위 ──────────────
// 예전 문제: 퇴근을 안 찍은 기록이 하나라도 있으면 **그 뒤 모든 출근이 조용히 무시**됐다.
//   → 어제 퇴근을 깜빡한 직원은 오늘부터 영영 출근을 찍을 수 없었고(화면엔 "근무 중"으로 보임),
//     버튼을 두 번 빨리 누르면 열린 기록이 2개 생겨 그 상태에 빠졌다.
// 지금 규칙: **24시간 안에 시작된 열린 기록만 "지금 근무 중"으로 본다.**
//   · 야간 교대(밤 10시 출근 → 새벽 2시)도 24시간 안이라 정상적으로 "근무 중"으로 잡힌다.
//   · 그보다 오래된 열린 기록은 "퇴근을 못 찍고 넘어간 것"이므로 새 출근을 막지 않는다.
//     (그 기록을 우리가 마음대로 닫지는 않는다 — 실제 퇴근 시각은 사람만 안다. 관리자가 [근태 정정]으로 바로잡는다)
// (상수·헬퍼는 lib/worktime.ts에 두어 화면과 서버가 같은 기준을 쓰게 한다)

export type ClockInResult = { ok: true } | { ok: false; reason: string };

// 출근 — 근무형태(사무실/재택/외근)와, 사무실이면 현재 좌표를 받는다.
// 사무실만 위치 확인. 재택·외근은 위치 확인 없음. 위치가 벗어나도 출근은 막지 않는다(부드럽게).
// 프라이버시: 좌표 원본은 저장하지 않고 확인 결과만 저장한다.
export async function clockIn(
  mode: "office" | "home" | "field" = "office",
  lat?: number,
  lng?: number
): Promise<ClockInResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "로그인이 풀렸습니다. 다시 로그인해주세요." };
  // 🔒 회사 계정은 사람이 아니다 — 출퇴근을 찍으면 법정 근로시간 기록에 유령 근로자가 생긴다(검수 9).
  if (me.isOwner) return { ok: false, reason: "회사 계정은 출퇴근을 기록하지 않습니다." };

  // 이미 근무 중(24시간 안에 시작한 열린 기록이 있음)이면 중복 생성 안 함.
  const since = openSessionSince();
  const open = await prisma.attendance.findFirst({
    where: { userId: me.id, clockOut: null, clockIn: { gte: since } },
  });
  if (open) {
    revalidatePath("/attendance");
    return { ok: false, reason: "이미 출근 상태입니다." };
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

  const created = await prisma.attendance.create({
    data: { userId: me.id, companyId: me.companyId, workMode: mode, locationStatus },
  });

  // 🔒 동시 요청 방어 (검수 C-4)
  //   위의 "이미 근무 중?" 검사와 생성 사이에 다른 요청이 끼어들 수 있다(버튼 더블클릭, 휴대폰+PC 동시).
  //   그러면 둘 다 "열린 기록 없음"을 보고 각각 하나씩 만들어 열린 기록이 2개가 된다.
  //   → 만든 직후 다시 세어 보고, 여러 개면 **가장 먼저 만들어진 것 하나만 남기고 내 것을 지운다.**
  //     두 요청이 같은 정렬 기준(생성시각→id)을 보므로 판단이 엇갈리지 않고 항상 하나로 수렴한다.
  const opens = await prisma.attendance.findMany({
    where: { userId: me.id, clockOut: null, clockIn: { gte: since } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (opens.length > 1 && opens[0].id !== created.id) {
    await prisma.attendance.delete({ where: { id: created.id } }); // 방금 만든 것이라 딸린 자료가 없다
    revalidatePath("/attendance");
    return { ok: false, reason: "이미 출근 처리되었습니다." };
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");

  // [접속기록] 출근이 실제로 생성된 경우에만(위 중복 클릭은 이미 return됨). meta=근무형태.
  await logClockAccess(me, "clock_in", mode);
  return { ok: true };
}

// 퇴근 — 열려있는(퇴근 안 한) 가장 최근 출근 기록에 퇴근 시각을 채운다.
// 외출 중에 퇴근을 누르면 외출도 함께 종료한다.
export async function clockOut(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  // 🔒 회사 계정은 사람이 아니다 — 출퇴근을 찍으면 법정 근로시간 기록에 유령 근로자가 생긴다(검수 9).
  if (me.isOwner) return;

  // 이번 근무 세션(24시간 안에 시작)의 열린 기록을 **전부** 닫는다.
  //  · 예전엔 가장 최근 1건만 닫아서, 중복으로 생긴 나머지가 영영 열린 채 남았고
  //    그 때문에 이후 출근이 전부 막혔다(검수 C-4).
  //  · 24시간보다 오래된 열린 기록은 건드리지 않는다 — 실제 퇴근 시각을 우리가 지어낼 수 없다.
  //    그런 기록은 관리자가 [근태 정정]으로 바로잡는다.
  const since = openSessionSince();
  const openList = await prisma.attendance.findMany({
    where: { userId: me.id, clockOut: null, clockIn: { gte: since } },
    orderBy: { clockIn: "desc" },
  });
  if (openList.length) {
    const now = new Date();
    const ids = openList.map((a) => a.id);
    // 열린 외출이 있으면 먼저 복귀 처리
    await prisma.break.updateMany({
      where: { attendanceId: { in: ids }, endAt: null },
      data: { endAt: now },
    });
    await prisma.attendance.updateMany({
      where: { id: { in: ids }, clockOut: null }, // 동시 퇴근 요청에도 한 번만 확정(멱등)
      data: { clockOut: now },
    });
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");

  // [접속기록] 실제로 퇴근 처리된 경우에만(열린 출근 기록이 있었을 때).
  if (openList.length) await logClockAccess(me, "clock_out", openList[0].workMode);
}

// 외출 시작 — 근무 중(출근했고 외출 안 한 상태)일 때만. 사유는 드롭다운에서 받는다.
export async function startBreak(formData: FormData): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  // 🔒 회사 계정은 사람이 아니다 — 출퇴근을 찍으면 법정 근로시간 기록에 유령 근로자가 생긴다(검수 9).
  if (me.isOwner) return;

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
    const created = await prisma.break.create({ data: { attendanceId: open.id, reason } });
    // 🔒 동시 요청 방어 (검수 C-4 — 출근과 같은 이유).
    //    외출 버튼을 두 번 빨리 누르면 겹치는 외출이 2건 생겨 **같은 시간이 두 번 차감**되고
    //    실근무시간이 실제보다 적게 계산된다. 만든 직후 세어 보고 먼저 만들어진 것만 남긴다.
    const openBreaks = await prisma.break.findMany({
      where: { attendanceId: open.id, endAt: null },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (openBreaks.length > 1 && openBreaks[0].id !== created.id) {
      await prisma.break.delete({ where: { id: created.id } });
    }
  }

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

// 복귀 — 열려있는 외출을 종료한다.
export async function endBreak(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) return;
  // 🔒 회사 계정은 사람이 아니다 — 출퇴근을 찍으면 법정 근로시간 기록에 유령 근로자가 생긴다(검수 9).
  if (me.isOwner) return;

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
