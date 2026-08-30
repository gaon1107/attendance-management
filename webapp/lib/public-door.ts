// 로그인 없이 누구나 부를 수 있는 **공개 창구**의 전역 상한 (보안검수 C-1).
//
// 🔴 왜 필요한가
//    이 제품에서 비밀번호를 대조하는 계산(scrypt)은 1회에 약 40ms가 걸린다.
//    공개 창구에 요청을 쏟으면 그 계산만으로 CPU가 전부 소모되어 **직원들이 출퇴근을 찍지 못한다.**
//    · 기존 IP 단위 제한(lib/login-throttle.ts)은 접속자 IP를 알아야 작동하는데, IP는
//      `TRUST_PROXY=1`(.env)일 때만 읽힌다(lib/ip.ts). 프록시를 세우기 전까지 **아무 일도 하지 않는다.**
//    · 계정 단위 5회 잠금은 "계정 하나"를 지킨다. 이건 "서버 전체"를 지킨다.
//    · 같은 위협을 운영자 로그인 문(lib/operator-policy.ts operatorDoorAllows)과
//      사업자번호 조회(app/api/bizreg-check)는 이미 이 방식으로 막아 두었다.
//      **고객사 로그인 쪽에만 없었다** — 그 구멍을 같은 방식으로 막는 것이 이 파일이다.
//
// 🔴 왜 프로세스 메모리인가 (DB로 세지 않는 이유)
//    DB를 세는 방식은 "세는 것 자체가 DB 부하"라 폭주 상황에서 역효과다.
//    이건 **DB와 scrypt에 닿기 전에** 끊는 것이 목적이므로 메모리에서 세야 한다.
//    · 한계 1: 서버를 여러 대로 늘리면 **대당 상한**이 된다(2대면 상한이 2배).
//              그때는 프록시나 Redis 같은 공용 저장소로 옮겨야 한다.
//    · 한계 2: 서버를 재시작하면 초기화된다(공격이 끊긴 것과 같은 효과라 문제되지 않는다).
//    · 진짜 방어는 배포 때 프록시에서 요청 수를 제한하는 것이다(docs/09_test/배포전_체크리스트.md).
//      이 파일은 그 앞단이 없을 때도 서버가 죽지 않게 하는 **최후의 안전판**이다.
//
// ⚠️ 이 상한은 **성공 요청도 함께 센다.** 계산 전에 세야 CPU를 아낄 수 있기 때문이다.
//    곧 "분당 처리량의 하드 상한"이므로, 값이 낮으면 정상 직원이 로그인하지 못한다.
//    그래서 세 가지 안전장치를 둔다:
//      ① .env로 값을 바꿀 수 있다(코드 수정·배포 불필요, 서버 재시작만)
//      ② 0으로 두면 상한이 **완전히 해제**된다(사고 시 즉시 원상복구하는 비상 스위치)
//      ③ 막힐 때마다 서버 로그에 남는다 — 정상 사용자가 걸리는지 눈으로 확인할 수 있다

/** 상한을 거는 창구들. 창구마다 따로 센다(로그인이 막혀도 가입은 열려 있다). */
export type DoorName = "login" | "signup" | "reset";

const WINDOW_MS = 60 * 1000;

// 기본값의 근거 (회사 100곳 · 직원 10,000명 기준으로 계산 — plan-보안검수-C1.md 3장)
//  · login  : 정상 피크 분당 36건, 세션 만료가 겹치는 최악 군집 분당 100건.
//             비동기 전환 전에는 375(CPU의 25%가 한계), 전환 후 600으로 올린다.
//  · signup : 회사 100곳 규모여도 가입은 하루 수십 건이다. 분당 60이면 넘칠 이유가 없다.
//  · reset  : 직원 10,000명 중 하루 1%가 잊어도 100명. 재설정 3개 창구가 이 예산을 **함께** 쓴다
//             (창구가 셋이라고 한도가 3배가 되면 안 된다 — login-throttle.ts의 reset_request와 같은 철학).
const DEFAULTS: Record<DoorName, number> = {
  login: 375,
  signup: 60,
  reset: 120,
};

/** .env에서 읽는 이름. 값이 없거나 이상하면 위 기본값을 쓴다. */
const ENV_KEYS: Record<DoorName, string> = {
  login: "LOGIN_DOOR_MAX_PER_MIN",
  signup: "SIGNUP_DOOR_MAX_PER_MIN",
  reset: "RESET_DOOR_MAX_PER_MIN",
};

/**
 * 창구별 상한값을 정한다. **서버 시작 시 한 번만** 읽는다(값을 바꾸려면 재시작).
 *  · 0 이면 상한 해제.
 *  · 숫자가 아니거나 음수면 기본값으로 되돌리고 경고를 남긴다 —
 *    오타 하나로 상한이 조용히 0(무방비)이 되거나 1(전면 차단)이 되면 안 된다.
 */
function readLimit(door: DoorName): number {
  const raw = process.env[ENV_KEYS[door]];
  if (raw == null || raw.trim() === "") return DEFAULTS[door];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    console.warn(`[public-door] ${ENV_KEYS[door]}="${raw}" 는 0 이상의 정수가 아닙니다 → 기본값 ${DEFAULTS[door]} 을 씁니다.`);
    return DEFAULTS[door];
  }
  return n;
}

const LIMITS: Record<DoorName, number> = {
  login: readLimit("login"),
  signup: readLimit("signup"),
  reset: readLimit("reset"),
};

/**
 * 창구별 최근 통과 시각들(밀리초). 창을 벗어난 것은 볼 때마다 버린다.
 * ⚠️ **통과한 것만** 넣는다. 막힌 것까지 넣으면 창이 스스로 갱신되어 **영구 차단**이 된다
 *    (같은 사고가 lib/login-throttle.ts 검수 치명 1에 기록되어 있다).
 *    통과한 것만 넣으므로 배열 길이는 상한값을 넘지 않는다 — 메모리가 무한히 자라지 않는다.
 */
const hits: Record<DoorName, number[]> = { login: [], signup: [], reset: [] };

/** 거부 로그를 남긴 마지막 시각 — 같은 창구는 1분에 1줄만 남긴다. */
const lastLogAt: Record<DoorName, number> = { login: 0, signup: 0, reset: 0 };
/** 그 1분 동안 거부한 건수 — 로그 한 줄에 함께 적는다. */
const blockedSinceLog: Record<DoorName, number> = { login: 0, signup: 0, reset: 0 };

/**
 * 지금 이 창구가 요청을 하나 더 받아도 되는가.
 *
 * **시도 자체를 세므로 부르면 1건이 기록된다** — 비밀번호 계산(scrypt)·DB 조회에 닿기 전에
 * 창구마다 딱 한 번 부른다.
 *
 * @returns 받아도 되면 true, 상한을 넘었으면 false(호출부는 계산 없이 거부한다)
 */
export function publicDoorAllows(door: DoorName, now: number = Date.now()): boolean {
  const limit = LIMITS[door];
  if (limit === 0) return true; // 비상 스위치 — 상한 해제

  const list = hits[door];
  const cutoff = now - WINDOW_MS;
  // 창을 벗어난 기록 버리기 — 배열은 시간순이라 앞에서부터 자르면 된다.
  let i = 0;
  while (i < list.length && list[i] < cutoff) i++;
  if (i > 0) list.splice(0, i);

  if (list.length >= limit) {
    // 🔴 로그를 **매 건마다** 남기지 않는다. 폭주 상황에서는 그 로그 자체가 디스크를 채우는
    //    또 하나의 공격 통로가 된다(lib/login-throttle.ts의 LOG_DEDUPE_MIN과 같은 이유).
    //    대신 1분에 한 줄로 "몇 건을 막았는지"를 함께 적어, 정상 사용자가 걸리는지 판단할 수 있게 한다.
    blockedSinceLog[door]++;
    if (now - lastLogAt[door] >= WINDOW_MS) {
      console.warn(
        `[public-door] '${door}' 창구가 분당 상한(${limit}건)에 걸려 요청을 거부했습니다. ` +
        `최근 1분 거부 ${blockedSinceLog[door]}건. ` +
        `정상 사용자가 걸리고 있다면 .env의 ${ENV_KEYS[door]} 값을 올리고 서버를 재시작하세요(0=해제).`
      );
      lastLogAt[door] = now;
      blockedSinceLog[door] = 0;
    }
    return false;
  }

  list.push(now);
  return true;
}

/** 지금 적용 중인 상한값(운영 확인·테스트용). 0이면 해제 상태다. */
export function publicDoorLimit(door: DoorName): number {
  return LIMITS[door];
}
