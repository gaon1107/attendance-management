// 문자 발송결과 회신 처리 (2026-11-22, 메시지 관리 3-3)
//  비즈모아샷은 문자를 **접수**한 뒤, 실제 전송 결과를 우리 서버 주소로 되돌려 보낸다(returnUrl).
//  주소는 app/api/sms/callback/[token]/route.ts, 본문 해석은 공용 모듈(@newgaon/moashot parseCallback)이 한다.
//  이 파일이 하는 일은 하나뿐이다 — **해석된 결과를 발송기록(SmsLog)의 도착 칸에 쓴다.**
//
// 🔴 건드리지 않는 것
//  · SmsLog.result(접수 결과) — 발송 상한(lib/sms.ts countRecentSends)이 그 값을 기준으로 센다.
//    도착 실패를 result="fail"로 바꾸면 그만큼 상한이 조용히 풀려 요금 방어선이 무너진다.
//    도착 결과는 deliveredAt·deliveryOk·deliveryCode·deliveryNote에만 쌓는다.
//  · refId(1회 제한 자리) — 도착 실패라고 자리를 풀면 같은 문자가 다시 나가 이중 과금이 된다.
//
// 보안·남용 방지 (로그인 없이 외부가 부르는 경로다)
//  · 토큰 확인은 route.ts가 한다. 여기까지 온 요청은 토큰이 맞은 것이다.
//  · **우리 기록에 있는 접수번호만** 갱신한다. 지어낸 번호는 조용히 무시(어떤 번호가 있는지도 알려주지 않는다).
//  · 이미 결과가 들어온 건(deliveredAt != null)은 다시 바꾸지 않는다 — 같은 회신이 두 번 와도 안전하다.
//  · 한 요청에서 처리할 결과 건수를 제한한다(토큰을 아는 자의 DB 부하 공격 상한).
//  · 본문을 통째로 로그에 남기지 않는다 — **수신 전화번호가 들어 있다.** 건수만 남긴다.
import { parseCallback } from "@newgaon/moashot";
import { prisma } from "@/lib/db";

/** 접수번호 허용 형식 — 공용 모듈(sms.js INDEX_CODE_PATTERN)과 같은 규칙. */
const INDEX_CODE_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
/**
 * 결과코드 허용 형식(숫자만). 비즈모아샷 코드표는 전부 숫자다(모듈 codes.js).
 *  이 검사가 두 가지를 한꺼번에 막는다:
 *  🔴 [검수 중간 6] **빈 코드**("접수ID,"처럼 짝이 안 맞게 올 때)를 모듈은 실패로 해석한다. 그대로 쓰면
 *     잘 도착한 문자가 "못 감"으로 **굳어버리고**(한 번 쓴 결과는 덮지 않는다), 사장님이 안 갔다고 믿고
 *     다시 보내면 요금이 두 번 나간다.
 *  🔴 [검수 경미 2] 숫자가 아닌 값이 오면 모듈이 사유를 "알 수 없는 결과코드(<받은 값>)"으로 만드는데,
 *     그 값이 **관리자 화면 "도착" 칸에 그대로 보인다** → 바깥에서 가짜 안내 문구를 띄울 수 있다.
 *  둘 다 "숫자가 아니면 아예 기록하지 않는다"로 막는다(기록하지 않으면 나중에 진짜 결과가 와서 채워진다).
 */
const RESULT_CODE_PATTERN = /^[0-9]{1,4}$/;
/**
 * 한 요청에서 처리할 최대 결과 건수 — 전송결과와 접수거부를 **합쳐서** 센다.
 *  근태는 한 번에 최대 30명까지 보낸다([메시지 발송]) → 결과도 그 정도다. 200이면 넉넉하고,
 *  그보다 많으면 우리 발송이 아니거나 부하 공격이므로 앞의 200건만 처리하고 경고를 남긴다.
 *  🔴 [검수 중간 2] 예전에는 둘을 따로 200씩 세어 한 요청이 400건까지 될 수 있었다.
 */
export const MAX_RESULTS_PER_REQUEST = 200;
/** 본문에서 읽을 최대 항목 수(양식 항목은 10개 남짓이다. 쓸데없이 큰 본문을 막는 상한). */
const MAX_BODY_FIELDS = 100;
/** 결과 사유를 기록에 남길 때의 최대 길이. */
const NOTE_MAX = 100;
/** 결과코드를 기록에 남길 때의 최대 길이. */
const CODE_MAX = 10;
/**
 * 발송기록에 접수번호를 쓰기 **전에** 회신이 먼저 도착했을 때 기다리는 시간.
 *  발송은 "기록 만들기 → 업체 호출 → 접수번호 쓰기" 순서이고, 업체 호출은 **최대 10초**까지 걸린다
 *  (lib/sms.ts SEND_TIMEOUT_MS). 즉 회신이 먼저 올 수 있는 구간이 10초다 — 1.5초만 기다리면 잔액 부족
 *  같은 **즉시 거부 회신을 놓친다**(2026-11-22 검수 중간 3). 그 구간을 덮도록 넉넉히 기다린다.
 *  응답은 이미 보낸 뒤라(route.ts after) 문자 회사를 기다리게 하지 않는다.
 */
const RETRY_DELAY_MS = 12_000;
/**
 * 다시 시도할 최대 건수.
 *  못 찾은 건이 이보다 많으면 우리 발송이 아닌 것으로 본다 — 모르는 번호 수백 건으로 서버를 12초씩
 *  붙잡지 못하게 하는 상한이다(검수 중간 2).
 */
const MAX_RETRY_ITEMS = 20;

/** 접수가 거부된 건의 기록 문구. 비즈모아샷이 보낸 원문은 그대로 쓰지 않는다(길이·내용을 믿을 수 없다). */
const REJECTED_NOTE = "문자 회사가 접수를 거부했습니다.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 양식 형식(form-urlencoded) 본문을 항목 객체로 푼다.
 *  · 🔴 Content-Type을 보지 않고 **본문 글자만** 읽는다. 비즈모아샷은 형식 표시 끝에 `;`를 붙여 보내는데,
 *    일반적인 양식 해석기는 그 표시를 모르는 형식으로 보고 본문을 비운 채 넘긴다(학원관리 운영에서 실제로
 *    결과가 "전송중"에 멈춘 원인 — 2026-10-03). 직접 읽으면 그 함정 자체가 없다.
 *  · 같은 이름이 두 번 오면 **처음 값**만 쓴다.
 *    ⚠️ 뒤이어 도는 공용 모듈(normalizeKeys)은 항목 이름을 소문자로 합치면서 **마지막 값**을 남긴다
 *    (예: `data`와 `DATA`가 같이 오면 `DATA`가 이긴다). 규칙이 서로 다르지만, 업체는 같은 이름을
 *    두 번 보내지 않으므로 실제 영향은 없다(2026-11-22 검수 경미 3 — 예전 주석이 "같은 규칙"이라 적혀 있었다).
 *  · 프로토타입 없는 객체를 쓴다 — 외부 입력이 항목 이름이 되므로(`__proto__` 등) 평범한 객체는 위험하다.
 */
export function parseFormBody(raw: string): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  let count = 0;
  try {
    for (const [key, value] of new URLSearchParams(raw)) {
      if (count >= MAX_BODY_FIELDS) break;
      if (Object.prototype.hasOwnProperty.call(out, key)) continue;
      out[key] = value;
      count += 1;
    }
  } catch {
    // 본문이 양식 형식이 아니어도 예외를 내지 않는다 — 빈 결과로 보고 끝낸다(응답은 늘 200이다).
    return Object.create(null) as Record<string, string>;
  }
  return out;
}

/** 도착 결과 한 건을 기록에 쓴다. 바꾼 건이 있으면 true. */
async function writeDelivery(indexCode: string, ok: boolean, code: string, note: string): Promise<boolean> {
  const res = await prisma.smsLog.updateMany({
    // 🔒 이미 결과가 들어온 건은 건드리지 않는다(중복 회신 안전). 우리 기록에 없는 번호는 0건이 된다.
    where: { indexCode, deliveredAt: null },
    data: {
      deliveredAt: new Date(),
      deliveryOk: ok,
      deliveryCode: code.slice(0, CODE_MAX),
      deliveryNote: note.slice(0, NOTE_MAX),
    },
  });
  return res.count > 0;
}

type Pending = { indexCode: string; ok: boolean; code: string; note: string };

/**
 * 우리 기록에 있고 **아직 결과가 안 들어온** 접수번호만 골라낸다(읽기 한 번).
 *  🔴 [검수 중간 2] 예전에는 건마다 바로 쓰기(updateMany)를 걸었다. 그러면 모르는 번호 수백 건을 보내는
 *     것만으로 쓰기가 수백 번 일어나는데, 이 제품의 DB(SQLite)는 **쓰기를 한 줄로 처리**하므로 그 사이
 *     출퇴근 찍기가 느려지거나 실패할 수 있다. 먼저 읽어서 우리 것만 추리면 모르는 번호는 쓰기를 전혀 일으키지 않는다.
 */
async function selectMine(list: Pending[]): Promise<Set<string>> {
  const rows = await prisma.smsLog.findMany({
    where: { indexCode: { in: list.map((p) => p.indexCode) }, deliveredAt: null },
    select: { indexCode: true },
  });
  return new Set(rows.map((r) => r.indexCode).filter((c): c is string => c !== null));
}

/** 한 바퀴 반영한다. 우리 것이 아닌(또는 아직 없는) 건은 쓰지 않고 그대로 돌려준다. */
async function applyOnce(list: Pending[]): Promise<{ updated: number; missed: Pending[] }> {
  if (list.length === 0) return { updated: 0, missed: [] };
  let mine: Set<string>;
  try {
    mine = await selectMine(list);
  } catch (e) {
    // 읽기에 실패하면 아무것도 쓰지 않는다 — 전부 "못 찾음"으로 넘겨 다음 바퀴에 맡긴다.
    console.error("[sms-callback] 발송기록 조회 실패:", e instanceof Error ? e.message : String(e));
    return { updated: 0, missed: list };
  }
  let updated = 0;
  const missed: Pending[] = [];
  for (const p of list) {
    if (!mine.has(p.indexCode)) {
      missed.push(p);
      continue;
    }
    try {
      // 고른 뒤에도 조건(deliveredAt: null)을 다시 걸고 쓴다 — 같은 회신이 동시에 두 번 와도 안전하다.
      if (await writeDelivery(p.indexCode, p.ok, p.code, p.note)) updated += 1;
    } catch (e) {
      // 접수번호는 비밀값이 아니므로 남겨도 되지만, 전화번호·본문은 애초에 여기 없다.
      console.error("[sms-callback] 도착 결과 기록 실패:", { indexCode: p.indexCode }, e);
    }
  }
  return { updated, missed };
}

/**
 * 해석된 결과 목록을 기록에 반영한다.
 *  · 못 찾은 건만 모아 **한 번** 다시 시도한다(위 RETRY_DELAY_MS).
 *  · 한 건이 실패해도 나머지를 계속 처리한다(DB 오류로 전체가 날아가지 않게).
 */
async function applyAll(list: Pending[]): Promise<{ updated: number; ignored: number }> {
  const first = await applyOnce(list);
  if (first.missed.length === 0) return { updated: first.updated, ignored: 0 };

  // 못 찾은 이유는 셋 중 하나다: ① 발송 쪽이 접수번호를 아직 안 썼다(경쟁) ② 이미 결과가 들어왔다
  // ③ 우리 것이 아니다. ①만 시간이 해결하므로 한 번 기다려 본다.
  if (first.missed.length > MAX_RETRY_ITEMS) {
    // 우리 발송은 한 번에 30건 안쪽이다 — 이보다 많이 모르는 번호가 왔으면 기다릴 이유가 없다.
    console.warn(`[sms-callback] 모르는 접수번호가 ${first.missed.length}건이라 다시 시도하지 않는다.`);
    return { updated: first.updated, ignored: first.missed.length };
  }
  await sleep(RETRY_DELAY_MS);
  const second = await applyOnce(first.missed);
  return { updated: first.updated + second.updated, ignored: second.missed.length };
}

/**
 * 회신 본문을 받아 발송기록을 갱신한다. **예외를 밖으로 던지지 않는다**(부르는 쪽은 이미 200을 돌려줬다).
 *  반환값은 로그·시험용 요약이다.
 */
export async function applySmsCallback(raw: string): Promise<{ type: number | null; updated: number; ignored: number }> {
  try {
    const parsed = parseCallback(parseFormBody(raw));

    const pending: Pending[] = [];

    // 상한은 아래 ①②를 **합쳐서** 센다(검수 중간 2).
    let dropped = 0;
    let badCode = 0;

    // ① 전송 결과(nType 2·3) — 정상 경로다.
    for (const r of parsed.results) {
      if (pending.length >= MAX_RESULTS_PER_REQUEST) {
        dropped += 1;
        continue;
      }
      if (!INDEX_CODE_PATTERN.test(r.indexCode)) continue;
      // 숫자 코드만 받는다 — 이유는 위 RESULT_CODE_PATTERN 주석(빈 코드·바깥 글자 두 가지를 막는다).
      if (!RESULT_CODE_PATTERN.test(r.code)) {
        badCode += 1;
        continue;
      }
      pending.push({ indexCode: r.indexCode, ok: r.ok, code: r.code, note: r.reason });
    }

    // ② 접수 거부(nType 1·3에 ErrMsg가 있을 때) — 접수 단계에서 막힌 것이므로 도착은 없다.
    //    우리 발송 응답은 성공이었는데 뒤늦게 거부되는 경우가 있어, 그 사실을 기록에 남긴다.
    //    사유는 **우리가 정한 고정 문구**를 쓴다 — 업체가 보낸 ErrMsg 원문은 화면에 그대로 띄우지 않는다.
    if (parsed.accepted && parsed.accepted.errMsg) {
      for (const indexCode of parsed.accepted.indexCodes) {
        if (pending.length >= MAX_RESULTS_PER_REQUEST) {
          dropped += 1;
          continue;
        }
        if (!INDEX_CODE_PATTERN.test(indexCode)) continue;
        // 결과 목록에 같은 번호가 이미 있으면 그쪽(전송 결과)이 더 정확하다 — 중복으로 넣지 않는다.
        if (pending.some((p) => p.indexCode === indexCode)) continue;
        pending.push({ indexCode, ok: false, code: "reject", note: REJECTED_NOTE });
      }
    }

    if (dropped > 0) console.warn(`[sms-callback] 상한(${MAX_RESULTS_PER_REQUEST}건)을 넘어 ${dropped}건을 버렸다.`);
    if (badCode > 0) console.warn(`[sms-callback] 결과코드가 숫자가 아니어서 ${badCode}건을 기록하지 않았다.`);

    const { updated, ignored } = await applyAll(pending);
    // 🔴 본문·전화번호는 남기지 않는다. 건수만.
    console.log(`[sms-callback] 회신 처리: nType=${parsed.type} 결과 ${pending.length}건 → 갱신 ${updated} / 무시 ${ignored}`);
    return { type: parsed.type, updated, ignored };
  } catch (e) {
    console.error("[sms-callback] 회신 처리 실패:", e instanceof Error ? e.message : String(e));
    return { type: null, updated: 0, ignored: 0 };
  }
}
