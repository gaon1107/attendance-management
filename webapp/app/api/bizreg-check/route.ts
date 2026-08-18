// [가입 화면] 사업자등록번호 **즉시 확인** 창구 — 칸을 벗어나는 순간 결과를 알려주기 위한 것.
//
// 왜 만들었나: 예전에는 6칸을 다 채우고 [가입]을 눌러야 "사업자번호가 올바르지 않습니다"가 떴다.
//   번호가 틀린 걸 마지막에 알게 되니 사용자가 헛수고를 한다(2026-08-18 사장님 지적).
//
// 🔴 이 창구는 **안내 전용**이다. 실제 차단은 지금처럼 가입 처리(app/actions/auth.ts)가 한다.
//    여기 결과가 좋게 나와도 가입 때 서버가 다시 확인한다 — 브라우저에서 온 말은 믿지 않는다.
//
// 🔴 **가입 여부는 절대 알려주지 않는다.** "이미 가입된 번호입니다"를 여기서 알려주면,
//    번호를 넣어보는 것만으로 어느 회사가 우리 고객인지 알아낼 수 있다(고객 명단 유출 통로).
//    그 안내는 가입 버튼을 눌렀을 때만 나온다.
//
// 🔴 **이 창구가 뚫리면 가입 검증 전체가 꺼진다**(검수 치명 1). 국세청 조회 쿼터가 마르면
//    lib/bizreg.ts는 fail-open으로 `unknown`을 주고, 가입은 그대로 통과한다. 즉 외부인이
//    조회를 퍼부어 쿼터를 태우는 것만으로 "가짜 사업자번호 차단"을 무력화할 수 있다.
//    그래서 아래 **3중 방어**를 둔다. 하나라도 빼면 안 된다.
//     ① 전역 상한(분당) — IP를 몰라도 항상 작동. 지금은 TRUST_PROXY가 없어 IP가 늘 null이라
//        IP별 제한만으로는 **아무것도 막지 못한다**(lib/ip.ts:20 → login-throttle.ts:153).
//     ② 국세청 일일 예산 — 쿼터를 다 쓰기 전에 우리가 먼저 멈춘다(가입 처리 몫을 남겨 둔다).
//     ③ 같은 출처(Origin) 검사 — 남의 사이트가 자기 방문자를 시켜 두드리는 길을 막는다.
//        방문자마다 IP가 달라 IP 제한으로는 못 막는다. 서버 액션과 달리 Route Handler는
//        Next가 이 검사를 해주지 않는다.
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { verifyBizRegNo, isValidBizRegNoFormat } from "@/lib/bizreg";
import { readClientMeta, recordAccess } from "@/lib/access-log";
import { tooLarge } from "@/lib/agent-auth";
import {
  publicActionAllowedForIp, recordThrottleHit,
  BIZREG_CHECK_MAX_PER_IP, BIZREG_CHECK_WINDOW_MIN,
} from "@/lib/login-throttle";

const MAX_LEN = 32;        // "123-45-67890"보다 훨씬 넉넉. 이보다 길면 정상 입력이 아니다.
const MAX_BODY = 1024;     // 본문은 번호 하나뿐이라 1KB면 충분(읽기 전에 막는다)

// ── ① 전역 상한(IP를 몰라도 작동) ──────────────────────────────────────
//  agent-auth.ts의 globalFails와 같은 방식: 서버 메모리에만 둔다(DB 표 추가 없음).
//  재시작하면 초기화되지만, 퍼붓기 공격은 짧은 시간에 몰아치므로 그래도 유효하다.
const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_MAX_PER_MIN = 20; // 사람이 정상적으로 이보다 많이 확인할 이유가 없다
let globalHits = { count: 0, firstAt: 0 };

// ── ② 국세청 일일 예산 ────────────────────────────────────────────────
//  이 창구가 쓸 수 있는 하루치. 가입 처리(actions/auth.ts)가 쓸 몫은 남겨 둔다.
//  ⚠️ 정상 가입 1건당 국세청 호출은 2번이다(여기 1 + 가입 처리 1 — 검수 중간 4).
//     서버가 브라우저 말을 안 믿는 설계라 일부러 그렇게 둔다. 예산은 그 몫을 뺀 값이다.
const DAILY_BUDGET = 300;
let daily = { day: "", used: 0 };

/** 오늘치 예산을 하나 쓴다. 남아 있으면 true. (한국 날짜 기준 — 서버 TZ=Asia/Seoul 전제) */
function spendDailyBudget(): boolean {
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
  if (daily.day !== today) daily = { day: today, used: 0 };
  if (daily.used >= DAILY_BUDGET) return false;
  daily.used += 1;
  return true;
}

/** ③ 우리 화면에서 온 요청인지. 남의 사이트가 방문자를 시켜 부르는 것을 막는다. */
function sameOrigin(h: Headers): boolean {
  // 브라우저는 교차 출처 요청에 Sec-Fetch-Site를 붙인다(same-origin / same-site / cross-site).
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") return false;
  const origin = h.get("origin");
  if (!origin) return !!site; // Origin이 없는데 브라우저 표식도 없으면 우리 화면이 아니다(curl 등)
  const host = h.get("host");
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// 화면에는 늘 같은 문구로 답한다 — 막힌 이유(예산 소진·퍼붓기 차단)를 밖에서 구분하지 못하게.
const CANT_CHECK = { state: "unknown", detail: "지금은 확인할 수 없습니다. 가입은 그대로 진행하실 수 있습니다." };

export async function POST(req: Request) {
  // 본문을 읽기 전에 크기부터 막는다 — 로그인 없이 부를 수 있는 창구라
  // 큰 본문 하나로 서버 메모리를 태울 수 있다(검수 치명 2).
  if (tooLarge(req, MAX_BODY)) {
    return NextResponse.json({ state: "invalid", detail: "요청이 너무 큽니다." }, { status: 413 });
  }
  const h = await headers();
  if (!sameOrigin(h)) {
    return NextResponse.json({ state: "unknown", detail: "" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ state: "invalid", detail: "요청 형식이 올바르지 않습니다." });
  }
  const raw = String((body as { bizRegNo?: unknown })?.bizRegNo ?? "").trim().slice(0, MAX_LEN);
  if (!raw) return NextResponse.json({ state: "empty", detail: "" });

  // 계산으로 먼저 거른다. 국세청에 묻지 않으므로 **횟수·예산을 쓰기 전에** 처리한다
  //  — 오타 한 번에 확인 횟수가 깎이면, 정작 제대로 고쳤을 때 확인을 못 받는다.
  if (!isValidBizRegNoFormat(raw)) {
    return NextResponse.json({ state: "invalid", detail: "올바른 사업자등록번호가 아닙니다. 10자리 숫자를 확인해주세요." });
  }

  // ① 전역 상한 — IP를 못 읽는 지금 상태에서 **유일하게 실제로 작동하는** 방어다.
  const now = Date.now();
  if (now - globalHits.firstAt > GLOBAL_WINDOW_MS) globalHits = { count: 1, firstAt: now };
  else globalHits.count += 1;
  if (globalHits.count > GLOBAL_MAX_PER_MIN) {
    return NextResponse.json(CANT_CHECK);
  }

  // IP별 상한 — TRUST_PROXY를 켠 뒤부터 작동한다(그전엔 위 전역 상한이 대신 지킨다).
  const client = readClientMeta(h);
  if (!(await publicActionAllowedForIp(client.ip, "bizreg_check", BIZREG_CHECK_MAX_PER_IP, BIZREG_CHECK_WINDOW_MIN))) {
    // 거부 기록은 1분에 1건만 남긴다(감사 흔적은 남기되, 막힌 뒤의 반복이 DB를 채우지 않게).
    await recordThrottleHit({ ip: client.ip, kind: "public_request", meta: "bizreg_check_blocked", userAgent: client.userAgent });
    return NextResponse.json(CANT_CHECK);
  }

  // ② 일일 예산 — 다 썼으면 국세청에 묻지 않는다. 가입 자체는 계속 가능하다(fail-open 유지).
  if (!spendDailyBudget()) {
    console.warn("[bizreg-check] 오늘치 조회 예산을 모두 사용했습니다 — 확인을 건너뜁니다.");
    return NextResponse.json(CANT_CHECK);
  }

  // 이 기록이 곧 IP별 제한의 근거가 된다(kind·meta를 정확히 맞춰야 세어진다).
  if (client.ip) {
    await recordAccess({ companyId: null, userId: null, kind: "public_request", result: "success", ip: client.ip, userAgent: client.userAgent, meta: "bizreg_check" });
  }

  // 국세청에 묻는다. 못 물어보면 unknown(가입을 막지 않는 쪽) — lib/bizreg.ts의 fail-open 정책 그대로.
  const check = await verifyBizRegNo(raw);
  return NextResponse.json({ state: check.state, detail: check.detail });
}
