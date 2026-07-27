// [PC 에이전트] 사건 기록 업로드 — 잠금·해제·일시사용 같은 "일어난 일"을 묶어서 보낸다.
//  · 오프라인이었다가 복구되면 쌓아둔 것을 한 번에 보내므로 **배열(묶음)만** 받는다(호출 수를 줄인다).
//  · ⚠️ 저장하는 것: 사건 종류·시각·짧은 사유뿐. 화면·입력 내용·앱 목록은 받지도, 저장할 칸도 없다.
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAgent, touchDevice, tooLarge, MAX_BODY_EVENTS } from "@/lib/agent-auth";
import { parseTempReasons, isTempUseType, TEMP_USE_TYPE, TEMP_USE_OFFLINE_TYPE, EVENT_MAX_AGE_DAYS } from "@/lib/pcoff";
import { purgeAgentEventsDaily } from "@/lib/pcoff-retention";

// 허용 종류(화이트리스트) — 모르는 종류는 조용히 버린다. 나중에 늘릴 땐 [PC관리] 화면의 라벨도 함께 늘린다.
//  · ⚠️ temp_use_offline(인터넷이 끊긴 동안의 일시사용)을 여기 넣지 않으면 **그 기록이 통째로 사라진다.**
//    앱은 보냈다고 여기고 지우므로 되살릴 방법이 없다(오프라인 보완 3번의 짝).
const ALLOWED_TYPES = new Set(["lock", "unlock", TEMP_USE_TYPE, TEMP_USE_OFFLINE_TYPE, "notify", "offline", "paired"]);
const MAX_EVENTS = 100;   // 한 번에 받는 최대 건수(지시서 §4-2)
const MAX_META_LEN = 200; // 사유 등 부가정보 길이 상한

export async function POST(req: Request) {
  // 본문을 읽기 전에 크기부터 막는다 — 아래 100건 제한은 JSON을 다 읽은 뒤라 메모리를 지켜주지 못한다.
  if (tooLarge(req, MAX_BODY_EVENTS)) {
    return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 413 });
  }

  const res = await authenticateAgent(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { auth } = res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.events;

  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "events 배열이 필요합니다." }, { status: 400 });
  }
  if (raw.length > MAX_EVENTS) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_EVENTS}건까지 보낼 수 있습니다.` }, { status: 400 });
  }

  const now = Date.now();
  const rows: { companyId: string; userId: string; deviceId: string; type: string; at: Date; meta: string | null; clientEventId: string | null }[] = [];
  let dropped = 0;
  const seenIds = new Set<string>(); // 한 배치 안의 중복도 걸러낸다(DB 제약과 별개로 미리)

  // [일시사용] 사유는 회사가 정한 목록의 값만 저장한다(자유서술 금지).
  //  · 이유: 자유서술은 직원이 질병·가족 사정 같은 민감정보를 스스로 적게 되는 통로가 된다(노무사 자료 제4권 2.1).
  //  · ⚠️ 목록에 없는 값이 와도 **다른 사유로 바꾸지 않는다**. 비워 둘 뿐이다.
  //    (관리자가 사유 목록을 바꾼 직후 앱이 옛 목록으로 보낼 수 있는데, 그걸 임의로 치환하면
  //     직원이 고르지 않은 사유가 기록에 남는다 = 없는 사실을 만드는 것.)
  //  · 사유를 못 알아봐도 사건 자체는 저장한다 — 기록을 잃으면 근로시간 근거가 사라지기 때문.
  //  · 오프라인 일시사용(temp_use_offline)도 **같은 목록**으로 검사한다 — 사유를 고르는 화면이 같기 때문이다.
  const hasTempUse = raw.some((it) => isTempUseType(String(((it ?? {}) as Record<string, unknown>).type ?? "")));
  let tempReasons: string[] | null = null;
  if (hasTempUse) {
    try {
      const c = await prisma.company.findUnique({
        where: { id: auth.user.companyId },
        select: { pcOffTempReasons: true },
      });
      tempReasons = parseTempReasons(c?.pcOffTempReasons);
    } catch (e) {
      // 사유 확인에 실패했다고 잠금·해제 기록까지 잃으면 안 된다 — 사유만 비우고 저장은 진행한다.
      console.warn("[agent] 일시사용 사유 목록 조회 실패(사유 없이 저장):", e);
      tempReasons = [];
    }
  }

  for (const item of raw) {
    const e = (item ?? {}) as Record<string, unknown>;
    const type = String(e.type ?? "");
    if (!ALLOWED_TYPES.has(type)) { dropped++; continue; }

    // 시각: 앱이 보낸 값을 쓰되(오프라인 후 뒤늦게 올 수 있어서), 말이 안 되는 값은 버린다.
    //  · 미래 5분 초과 = PC 시계가 앞서 있거나 조작.
    //  · 과거 한계는 EVENT_MAX_AGE_DAYS(정책 일수 + 여유). ⚠️ 정책 일수(31일)보다 짧으면
    //    한 달 오프라인이던 PC의 첫날 기록이 버려진다 — 200을 주므로 앱은 그대로 지운다(복구 불가).
    const at = new Date(String(e.at ?? ""));
    if (Number.isNaN(at.getTime())) { dropped++; continue; }
    const diff = at.getTime() - now;
    if (diff > 5 * 60 * 1000 || diff < -EVENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) { dropped++; continue; }

    // ⚠️ meta(부가정보)는 [일시사용] 사유에만 쓴다. 다른 종류는 서버에서 무조건 비운다.
    //    그러지 않으면 앱이 "해제 사유" 같은 자유입력을 붙이는 순간 민감정보 차단이 무력해진다.
    let meta: string | null = null;
    if (isTempUseType(type)) {
      const metaRaw = e.meta == null ? "" : String(e.meta).normalize("NFC").trim();
      const cut = metaRaw ? Array.from(metaRaw).slice(0, MAX_META_LEN).join("") : "";
      // 목록에 있는 값만 저장. 그 외(자유서술 포함)는 null = "사유 미확인"으로 남긴다(치환하지 않는다).
      meta = cut && tempReasons?.some((r) => r.normalize("NFC") === cut) ? cut : null;
    }

    // 재전송 중복 방지용 고유번호(앱이 붙인다). 같은 배치에 두 번 들어오면 뒤엣것은 버린다.
    const cidRaw = e.clientEventId == null ? "" : String(e.clientEventId).trim().slice(0, 64);
    const clientEventId = cidRaw || null;
    if (clientEventId) {
      if (seenIds.has(clientEventId)) { dropped++; continue; }
      seenIds.add(clientEventId);
    }

    rows.push({
      companyId: auth.user.companyId, // ⚠️ 회사·직원은 토큰에서만 가져온다(앱이 보낸 값은 믿지 않는다 = 테넌트 격리)
      userId: auth.user.id,
      deviceId: auth.device.id,
      type, at, meta, clientEventId,
    });
  }

  // 이미 저장된 사건(같은 기기 + 같은 고유번호)은 건너뛴다 = 재전송해도 두 번 세지 않는다.
  //  · ⚠️ SQLite는 createMany의 skipDuplicates를 지원하지 않아, 먼저 조회해서 걸러낸다.
  //    (동시에 같은 배치가 두 번 들어오는 아주 드문 경우는 DB의 유니크 제약이 최종 방어선 — 아래 catch)
  const ids = rows.map((r) => r.clientEventId).filter((v): v is string => !!v);
  let saved = 0, duplicated = 0;
  if (ids.length > 0) {
    const already = await prisma.agentEvent.findMany({
      where: { deviceId: auth.device.id, clientEventId: { in: ids } },
      select: { clientEventId: true },
    });
    const dupSet = new Set(already.map((a) => a.clientEventId));
    duplicated = dupSet.size;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].clientEventId && dupSet.has(rows[i].clientEventId)) rows.splice(i, 1);
    }
  }
  if (rows.length > 0) {
    try {
      await prisma.agentEvent.createMany({ data: rows });
      saved = rows.length;
    } catch {
      // 경쟁 상황(같은 순간 같은 사건이 두 번 도착)에서 유니크 제약에 걸린 경우 —
      // 통째로 실패시키지 않고 한 건씩 넣어 정상 건은 살린다.
      for (const r of rows) {
        try { await prisma.agentEvent.create({ data: r }); saved++; }
        catch { duplicated++; }
      }
    }
  }
  // 생존신호는 부가 기능 — 실패해도 사건 저장 결과를 정상으로 돌려준다(앱이 같은 배치를 계속 재전송하지 않게).
  try {
    await touchDevice(auth.device.id, typeof b.agentVersion === "string" ? b.agentVersion.slice(0, 20) : null);
  } catch (e) {
    console.warn("[agent] 생존신호 기록 실패(사건 저장은 정상):", e);
  }

  // 보관기간이 지난 옛 기록 파기(하루 1회만 실제로 돈다).
  //  · after() = 응답을 보낸 **뒤**에 실행. 삭제가 오래 걸려도 앱을 기다리게 하지 않는다
  //    (lib/clock-photo.ts를 쓰는 app/records/page.tsx와 같은 방식).
  after(() => purgeAgentEventsDaily());

  return NextResponse.json({ ok: true, saved, dropped, duplicated });
}
