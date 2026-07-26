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
    select: { id: true, name: true, companyId: true, deactivatedAt: true, company: { select: { name: true } } },
  });
  if (!user || user.deactivatedAt) {
    return NextResponse.json({ error: "사용할 수 없는 계정입니다." }, { status: 403 });
  }

  const token = generateDeviceToken();
  const tokenHash = hashToken(token);

  // 같은 직원의 같은 이름 PC가 이미 있으면 "다시 연결"로 본다(앱 재설치·토큰 분실).
  //  · 기존 기기를 지우지 않고 새 토큰으로 갱신 → 그 PC의 과거 이벤트 기록이 끊기지 않는다.
  const existing = await prisma.agentDevice.findFirst({
    where: { userId: user.id, companyId: user.companyId, deviceName },
    select: { id: true },
  });

  const device = existing
    ? await prisma.agentDevice.update({
        where: { id: existing.id },
        data: { tokenHash, agentVersion, pairedAt: new Date(), lastSeenAt: new Date(), revokedAt: null },
        select: { id: true },
      })
    : await prisma.agentDevice.create({
        data: { companyId: user.companyId, userId: user.id, deviceName, tokenHash, agentVersion, lastSeenAt: new Date() },
        select: { id: true },
      });

  // 연결 사실을 기록(관리자 [PC관리]에서 "언제 연결했나" 확인 — 감사 목적).
  await prisma.agentEvent.create({
    data: { companyId: user.companyId, userId: user.id, deviceId: device.id, type: "paired", at: new Date() },
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
