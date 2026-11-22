// [PC 에이전트] 연결(페어링) — 직원이 웹 [계정]에서 발급받은 6자리 코드를 앱에 입력하면 이 통로로 들어온다.
//  · 성공하면 그 PC에 "기기 토큰"을 발급한다. 토큰 평문은 **이 응답 한 번만** 나가고 DB엔 해시만 남는다.
//  · 보호: ①코드 5분·1회용 ②코드 찍기(무차별 대입) IP 차단 ③퇴사자 차단 ④한 직원의 같은 이름 PC는 재연결로 처리
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getClientIp } from "@/lib/ip";
import {
  consumePairCode, generateDeviceToken, hashToken,
  isPairBlocked, recordPairFail, clearPairFails, tooLarge, MAX_BODY_PAIR,
} from "@/lib/agent-auth";
import { ADMIN_ISSUED_META_PREFIX } from "@/lib/pcoff";
import { recordAccess } from "@/lib/access-log";

const MAX_NAME_LEN = 80;

export async function POST(req: Request) {
  // 로그인 없이 부를 수 있는 창구라 본문 크기부터 막는다(대용량 요청으로 서버를 마비시키는 것 방지).
  if (tooLarge(req, MAX_BODY_PAIR)) {
    return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }

  const ip = getClientIp(req.headers);
  if (isPairBlocked(ip)) {
    return NextResponse.json({ error: "연결 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const code = String(b.code ?? "").trim();
  const deviceNameRaw = String(b.deviceName ?? "").trim();
  const agentVersion = b.agentVersion ? String(b.agentVersion).trim().slice(0, 20) : null;

  if (!/^\d{6}$/.test(code)) {
    recordPairFail(ip);
    return NextResponse.json({ error: "연결코드는 6자리 숫자입니다." }, { status: 400 });
  }
  if (!deviceNameRaw) {
    return NextResponse.json({ error: "컴퓨터 이름이 필요합니다." }, { status: 400 });
  }
  const deviceName = Array.from(deviceNameRaw).slice(0, MAX_NAME_LEN).join("");

  const claimed = await consumePairCode(code);
  if (!claimed) {
    recordPairFail(ip);
    // 사유(없는 코드/만료/사용됨)를 구분해 알려주지 않는다 — 코드 찾기 힌트가 되기 때문.
    return NextResponse.json({ error: "연결코드가 올바르지 않거나 만료되었습니다. 웹에서 새 코드를 발급받아 주세요." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: claimed.userId },
    select: { id: true, name: true, companyId: true, deactivatedAt: true, company: { select: { name: true, terminatedAt: true } } },
  });
  if (!user || user.deactivatedAt) {
    return NextResponse.json({ error: "사용할 수 없는 계정입니다." }, { status: 403 });
  }
  // 🔴 해지(탈퇴)된 회사의 새 연결은 받지 않는다(2026-11-22 재검수 중간 C).
  //  · 이 경로는 **로그인 없이** 닿는다 — 연결코드(5분)만 있으면 들어온다. 해지 직전에 받은 코드는 해지 뒤에도 유효하다.
  //  · 막지 않으면 서비스가 중지된 회사에 기기가 새로 등록되고 연결 기록이 남으며, **응답으로 회사 이름까지 나간다.**
  //  · 이후 모든 에이전트 API는 authenticateAgent가 막지만(lib/agent-auth.ts), 입구를 열어 두면 "서비스 중지"가 반쪽이 된다.
  if (user.company.terminatedAt) {
    return NextResponse.json({ error: "서비스 이용이 종료된 회사입니다. 가온 고객지원으로 문의해 주세요." }, { status: 403 });
  }

  const token = generateDeviceToken();
  const tokenHash = hashToken(token);

  // 같은 직원의 같은 이름 PC가 이미 있으면 "다시 연결"로 본다(앱 재설치·토큰 분실).
  //  · 기존 기기를 지우지 않고 새 토큰으로 갱신 → 그 PC의 과거 이벤트 기록이 끊기지 않는다.
  const existing = await prisma.agentDevice.findFirst({
    where: { userId: user.id, companyId: user.companyId, deviceName },
    select: { id: true, revokedAt: true },
  });

  // 🔒 관리자가 직원 대신 발급한 코드로는 **지금 살아 있는** 같은 이름의 PC를 가로채지 못한다(재검수 M-a).
  //    컴퓨터 이름은 앱이 보내는 값이라 흉내 낼 수 있다. 막지 않으면 관리자가 자기 PC를 직원 PC 이름으로 연결해
  //    직원의 진짜 PC를 끊고(토큰 교체) 그 이름으로 잠금 기록을 만들 수 있다.
  //    같은 PC를 다시 설치하는 정상 상황이면 [PC관리]에서 먼저 연결 해제 → 그 기록이 남는다.
  if (claimed.issuedById && existing && !existing.revokedAt) {
    return NextResponse.json(
      { error: "이 직원에게 같은 컴퓨터 이름으로 연결된 PC가 이미 있습니다. [PC관리]에서 기존 연결을 해제하거나 컴퓨터 이름을 바꾼 뒤, 새 연결코드로 다시 시도해 주세요." },
      { status: 409 }
    );
  }

  // 관리자가 직원 대신 발급한 코드로 연결했으면 그 관리자를 기기에 적는다(2026-11-20 검수 M-1).
  //  · [PC관리]·직원 본인 [계정]에 "관리자 발급 코드로 연결된 적 있는 PC"로 보인다 — 직원 모르게 그 이름으로 연결하는 일을 드러낸다.
  //  · 🔒 한 번 적히면 **지우지 않는다**(재검수 M-a): 직원이 나중에 본인 코드로 다시 연결해도 표시가 남는다.
  //    (덮어쓰면 직원의 정상적인 재연결이 흔적을 지워 버린다) 관리자 발급으로 다시 연결하면 그 관리자로 바뀐다.
  const pairedBy = claimed.issuedById
    ? { pairedByAdminId: claimed.issuedById, pairedByAdminName: claimed.issuedByName }
    : {};
  const device = existing
    ? await prisma.agentDevice.update({
        where: { id: existing.id },
        data: { tokenHash, agentVersion, pairedAt: new Date(), lastSeenAt: new Date(), revokedAt: null, ...pairedBy },
        select: { id: true },
      })
    : await prisma.agentDevice.create({
        data: { companyId: user.companyId, userId: user.id, deviceName, tokenHash, agentVersion, lastSeenAt: new Date(), ...pairedBy },
        select: { id: true },
      });

  // 관리자 발급 연결은 **접속기록(2년 보관)**에도 남긴다(재검수 M-a) — 연결 기록(paired)은 시스템 기록이라 90일 뒤 파기되지만,
  //  그 PC가 만든 잠금·해제 기록은 3년 보관이라 분쟁 때 "그 기간은 관리자 발급 연결이었다"는 근거가 먼저 사라지면 안 된다.
  //  행위자 = 코드를 발급한 관리자(실제로 PC에 넣은 사람은 알 수 없다). 실패해도 연결은 계속(recordAccess는 예외를 삼킨다).
  if (claimed.issuedById) {
    await recordAccess({
      companyId: user.companyId, userId: claimed.issuedById, actorName: claimed.issuedByName,
      kind: "config", result: "success", ip, userAgent: req.headers.get("user-agent"),
      meta: `pcoff_admin_pair_connected:${user.name} (PC ${deviceName})`,
    });
  }

  // 연결 사실을 기록(관리자 [PC관리]에서 "언제 연결했나" 확인 — 감사 목적).
  //  meta: 관리자 발급이면 "admin_issued:관리자이름" — 기록 목록에도 남는다(기기 표시는 다시 연결하면 바뀌지만 이 기록은 남는다).
  await prisma.agentEvent.create({
    data: {
      companyId: user.companyId, userId: user.id, deviceId: device.id, type: "paired", at: new Date(),
      meta: claimed.issuedById ? `${ADMIN_ISSUED_META_PREFIX}${claimed.issuedByName ?? ""}`.slice(0, 120) : null,
    },
  });

  clearPairFails(ip);

  return NextResponse.json({
    ok: true,
    token, // ⚠️ 평문 토큰은 여기서 딱 한 번만 나간다. 앱이 안전하게 보관해야 한다.
    deviceId: device.id,
    userName: user.name,
    companyName: user.company.name,
    reconnected: !!existing,
  });
}
