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
// 🔴 이 상한은 **성공 요청도 함께 센다** — 계산 전에 세야 CPU를 아낄 수 있기 때문이다.
//    곧 "분당 처리량의 하드 상한"이다. **값을 낮게 잡으면 이 장치 자체가 서비스를 멈추는 수단이 된다.**
//    (검수 2026-08-30 치명 1) 상한이 걸리는 순간 **비밀번호가 맞은 사람도 함께 막히므로**,
//    공격자 입장에서는 "CPU를 태우는 것"보다 "상한을 채워 전원을 막는 것"이 더 싸고 확실한 공격이 된다.
//    → 그래서 이 값은 **서버가 실제로 위험해지는 지점 근처**에 두어야 하고,
//      "정상 사용량의 몇 배"로 잡으면 안 된다. 아래 DEFAULTS의 근거를 반드시 함께 읽을 것.
//
// ⚠️ 안전장치 세 가지
//      ① .env로 값을 바꿀 수 있다(코드 수정·배포 불필요, 서버 재시작만)
//      ② 0으로 두면 상한이 **완전히 해제**된다(사고 시 즉시 원상복구하는 비상 스위치)
//      ③ 막히면 서버 로그에 1분 1줄로 남는다
//         ⚠️ **③은 로그를 파일로 남길 때만 작동한다.** 지금 개발용 실행 방식(근태관리_실행.bat)은
//            콘솔 창에만 찍고 창을 닫으면 사라진다. 운영 배포 시 반드시 로그를 파일로 남길 것
//            (docs/09_test/배포전_체크리스트.md 3-2). 안 그러면 "직원들이 로그인을 못 했다"는
//            신고가 들어와도 증거가 하나도 없다.

/** 상한을 거는 창구들. 창구마다 따로 센다(로그인이 막혀도 가입은 열려 있다). */
export type DoorName = "login" | "signup" | "reset";

const WINDOW_MS = 60 * 1000;

// 기본값의 근거
//
// 🔴 값을 정하는 기준이 2026-08-30 검수(치명 1)로 **바뀌었다.** 반드시 읽을 것.
//    [바뀌기 전] "정상 사용량의 몇 배"로 잡았다 → 로그인 600(정상 피크 36의 약 16배).
//    [바뀐 뒤]   그 방식은 틀렸다. 서버는 분당 수천 건을 처리할 수 있는데 상한이 600이면,
//               **서버가 멀쩡한데 사람이 먼저 막힌다.** 공격자는 초당 10건만 보내면
//               (CPU를 태울 필요도 없이) 전 고객사 직원의 로그인을 끊을 수 있었다.
//    → 이제 기준은 **"서버가 실제로 버티는 양의 절반쯤"** 이다.
//
//  · login  : 비밀번호 계산 1회 약 40ms, 작업 스레드 4개(libuv 기본) → **분당 약 6,000건이 한계.**
//             그 절반인 **3,000**을 상한으로 둔다.
//             · 정상 피크는 분당 36건, 세션 만료가 겹치는 최악 군집도 분당 100건이므로 **30배 여유**다.
//               정상 직원이 여기 걸릴 일은 사실상 없다.
//             · 그러면서도 폭주 시 작업 스레드가 통째로 잠겨 로그인이 무한정 밀리는 것은 막는다.
//             · `UV_THREADPOOL_SIZE`를 올린 서버라면 이 값도 함께 올릴 수 있다(.env).
//  · signup : 회사 100곳 규모여도 가입은 하루 수십 건이다. 분당 60이면 넘칠 이유가 없다.
//             (가입은 국세청 조회 쿼터까지 태우므로 로그인과 달리 넉넉하게 잡을 이유가 없다)
//  · reset  : 직원 10,000명 중 하루 1%가 잊어도 100명. 재설정 **4개** 창구가 이 예산을 **함께** 쓴다
//             (창구 수만큼 한도가 늘면 안 된다 — login-throttle.ts의 reset_request와 같은 철학).
const DEFAULTS: Record<DoorName, number> = {
  login: 3000,
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

  // 🔴 시계가 **뒤로 갔을 때** 문이 통째로 잠기는 것을 막는다(검수 2026-08-30 중간 3).
  //    아래 정리는 "배열이 시간순"이라는 가정 위에 서 있는데, 시스템 시계는 뒤로 갈 수 있다
  //    (NTP 대폭 보정 · 가상서버 스냅샷 복원 · 관리자의 수동 시각 변경).
  //    뒤로 가면 배열 맨 앞에 '미래' 시각이 남아 아무것도 버려지지 않고,
  //    **되돌린 시간만큼(1시간을 되돌리면 61분간) 아무도 로그인하지 못한다.** 실측으로 확인된 값이다.
  //    → 시간이 거꾸로 흘렀다면 지금까지의 기록은 의미가 없으므로 그냥 버린다(막는 쪽이 아니라 여는 쪽).
  if (list.length > 0 && now < list[list.length - 1]) {
    list.length = 0;
    lastLogAt[door] = 0;      // 미래 시각으로 남아 있으면 경고 로그가 영영 안 나온다
    blockedSinceLog[door] = 0;
  }

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
        // "최근 1분"이 아니다 — 거부가 드문드문 일어나면 이 값은 훨씬 긴 기간의 합계다(검수 경미 1).
        `직전 경고 이후 거부 ${blockedSinceLog[door]}건. ` +
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
