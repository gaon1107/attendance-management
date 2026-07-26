// [PC-OFF] 사건 기록 자동 파기 — 보관기간이 지난 AgentEvent를 지운다.
//
// 왜 필요한가: 근로 분쟁만 보면 오래 보관할수록 회사에 유리해 보이지만, 개인정보보호법 제21조는
//   "보유기간이 지난 개인정보를 지체 없이 파기"하도록 정한다. 즉 무기한 보관은 그 자체가 위반이다.
//   (노무사 상담 자료 제4권 3.2·3.3, 최종부록 D-1)
//
// 보관 계층 (lib/pcoff.ts에 단일 출처):
//   · 잠금·해제·일시사용 → 3년   : 근로시간·수당 산정의 근거 = 근로기준법 제42조 보존 대상
//   · 사전알림·오프라인·연결 → 90일 : 장비 상태 기록일 뿐 임금과 무관 → 최소보관 원칙
//   · 퇴사자                 → 퇴사일 + 3년 : 퇴직 직후 3년이 임금체불 진정이 가장 많은 구간이라
//                                            즉시 삭제는 오히려 회사에 불리하다(제4권 4.2).
//
// ⚠️ 이 파일은 **전 회사의 기록을 되돌릴 수 없게 삭제**한다. 그래서 두 겹의 안전장치를 둔다.
//   ① 1회 상한(PURGE_CAP): 한 번에 지울 게 상한을 넘으면 **아무것도 지우지 않고 중단**한다.
//      서버 시계가 미래로 틀어지는 등의 사고에서 3년치가 한 번에 날아가는 것을 막는 브레이크다.
//   ② at·createdAt **둘 다** 지난 것만 지운다. at은 앱이 보낸 값(조작 가능), createdAt은 서버 수신시각이라
//      한쪽만 보면 조기 파기(앱이 과거 시각 전송) 또는 과다 보관(늦게 올라온 기록)이 생긴다.
import { prisma } from "@/lib/db";
import { RETENTION_WORK_DAYS, RETENTION_SYSTEM_DAYS, SYSTEM_EVENT_TYPES } from "@/lib/pcoff";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 한 번에 지울 수 있는 최대 건수. 정상 운영이라면 하루치 만료분은 이 수를 넘지 않는다. */
export const PURGE_CAP = 5000;
/** SQLite는 파일 하나에 쓰기가 하나뿐이라, 큰 삭제를 한 번에 하면 다른 요청이 잠긴다. 잘라서 지운다. */
const CHUNK = 500;

export type PurgeResult = {
  work: number; system: number; resigned: number;
  aborted: boolean;   // 상한 초과로 중단됨(사람이 확인할 때까지 아무것도 지우지 않는다)
  note?: string;
};

/**
 * 보관기간이 지난 사건 기록을 실제로 삭제한다.
 *  · 기준 시각을 인자로 받는 이유: 임시 라우트로 검증할 때 "3년 뒤"를 흉내 낼 수 있어야 하기 때문.
 *    ⚠️ 이 값을 외부 입력(요청 본문·쿼리스트링)에서 받아 넘기는 라우트를 만들지 말 것.
 */
export async function purgeExpiredAgentEvents(now: Date = new Date()): Promise<PurgeResult> {
  const t = now.getTime();
  const systemCutoff = new Date(t - RETENTION_SYSTEM_DAYS * DAY_MS);
  const workCutoff = new Date(t - RETENTION_WORK_DAYS * DAY_MS);
  const sysTypes = [...SYSTEM_EVENT_TYPES];
  const over = PURGE_CAP + 1; // 상한을 넘었는지 알기 위해 한 건 더 가져온다

  // ① 시스템 기록 90일 경과
  const systemIds = await pickIds(
    { type: { in: sysTypes }, at: { lt: systemCutoff }, createdAt: { lt: systemCutoff } },
    over
  );

  // ② 그 밖의 모든 종류(잠금·해제·일시사용 + 앞으로 늘어날 종류) 3년 경과
  //    ⚠️ notIn으로 쓰는 이유: 새 종류가 생겼을 때 목록에 넣는 걸 잊어도 "90일 만에 지우는" 쪽이 아니라
  //       "3년 보관" 쪽으로 안전하게 떨어지게 하기 위함이다(근로 기록 조기 파기가 더 위험).
  const workIds = await pickIds(
    { type: { notIn: sysTypes }, at: { lt: workCutoff }, createdAt: { lt: workCutoff } },
    over
  );

  // ③ 퇴사자: 퇴사일 + 3년이 지났으면 종류·시각을 가리지 않고 전부 파기
  //    (대부분은 ①②가 먼저 지우므로 실제로 걸리는 건 드물다 — 마지막 안전망)
  const longGone = await prisma.user.findMany({
    where: { deactivatedAt: { not: null, lt: workCutoff } },
    select: { id: true },
  });
  const resignedIds = longGone.length > 0
    ? await pickIds({ userId: { in: longGone.map((u) => u.id) } }, over)
    : [];

  // 중복 제거(퇴사자 기록이 ①②에도 잡힐 수 있다) 후 상한 검사
  const all = new Set([...systemIds, ...workIds, ...resignedIds]);
  if (all.size > PURGE_CAP) {
    const note = `한 번에 지울 건수(${all.size})가 상한 ${PURGE_CAP}건을 넘어 중단했습니다. 서버 시각과 데이터를 확인하세요.`;
    console.error(`[pcoff] 자동 파기 중단 — ${note}`);
    await writeLog({ work: 0, system: 0, resigned: 0, aborted: true, note });
    return { work: 0, system: 0, resigned: 0, aborted: true, note };
  }
  if (all.size === 0) return { work: 0, system: 0, resigned: 0, aborted: false };

  await deleteByIds([...all]);

  // 건수는 "어느 규칙으로 잡혔는지" 기준으로 센다(중복은 시스템→근로→퇴사자 순으로 한 번만).
  const counted = new Set<string>();
  const count = (ids: string[]) => {
    let n = 0;
    for (const id of ids) if (!counted.has(id)) { counted.add(id); n++; }
    return n;
  };
  const result: PurgeResult = {
    system: count(systemIds), work: count(workIds), resigned: count(resignedIds), aborted: false,
  };
  await writeLog(result);
  return result;
}

// 지울 대상 id만 먼저 뽑는다(상한 판단 + 잘라서 지우기 위해).
async function pickIds(where: object, take: number): Promise<string[]> {
  const rows = await prisma.agentEvent.findMany({ where, select: { id: true }, take });
  return rows.map((r) => r.id);
}

async function deleteByIds(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += CHUNK) {
    await prisma.agentEvent.deleteMany({ where: { id: { in: ids.slice(i, i + CHUNK) } } });
  }
}

// 파기 이력 — 개인 식별정보 없이 "언제 몇 건"만 남긴다. 실패해도 파기 자체는 성공으로 둔다.
async function writeLog(r: PurgeResult): Promise<void> {
  try {
    await prisma.agentPurgeLog.create({
      data: {
        workDeleted: r.work, systemDeleted: r.system, resignedDeleted: r.resigned,
        aborted: r.aborted, note: r.note ?? null,
      },
    });
  } catch (e) {
    console.error("[pcoff] 파기 이력 기록 실패(파기 자체는 완료):", e);
  }
}

// 하루 1회만 도는 게으른 실행기. 화면 열기·사건 업로드 같은 평소 동작에 얹는다.
//  · 메모리 변수는 1차 차단용일 뿐이고, **실제 기준은 DB의 마지막 실행 시각**이다
//    (서버 인스턴스가 여러 개여도 하루 여러 번 삭제가 돌지 않게 — 사진 파기와 달리 되돌릴 수 없으므로).
//  · 파기 실패가 본 기능(잠금·기록)을 막으면 안 되므로 예외는 삼키고 다음 기회에 재시도한다.
let lastPurgeAt = 0;
export async function purgeAgentEventsDaily(): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAt < DAY_MS) return;
  lastPurgeAt = now;

  try {
    const last = await prisma.agentPurgeLog.findFirst({
      orderBy: { ranAt: "desc" }, select: { ranAt: true },
    });
    if (last && now - last.ranAt.getTime() < DAY_MS) return; // 다른 인스턴스가 이미 돌렸다

    const r = await purgeExpiredAgentEvents();
    const total = r.work + r.system + r.resigned;
    if (total > 0) {
      console.log(
        `[pcoff] 보관기간 경과 사건 파기 — 근로기록(3년) ${r.work}건 · 시스템기록(90일) ${r.system}건 · 퇴사자 ${r.resigned}건`
      );
    }
  } catch (e) {
    lastPurgeAt = 0; // 다음 요청에서 다시 시도
    console.error("[pcoff] 자동 파기 실패:", e);
  }
}
