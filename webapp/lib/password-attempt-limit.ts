// 로그인한 사람이 **자기 비밀번호를 대조받는 창구**의 계정별 분당 상한 (검수 H-1 후속, 2026-08-30).
//
// 🔴 왜 생겼나 — H-1에서 잘못 지운 제동장치를 **잠금이 아닌 방식으로** 되살린 것이다.
//    [사고 경위] H-1으로 "5회 실패 → 10분 잠금"을 없앴다. 로그인 문에서는 그 잠금이 비밀번호 대조
//    **뒤**에 있어 실제로는 아무것도 막지 못하던 죽은 코드였다(실측). 그런데 `app/actions/account.ts`의
//    두 창구(비밀번호 변경 · 복구용 연락처 변경)에서는 잠금이 대조 **앞**에 있어서
//    **살아 있는 제동장치**였다 — 계정당 10분에 5회. 그걸 함께 지워 상한이 0이 됐다.
//
//    [지우면 무슨 일이 나나]
//     ① **세션을 손에 넣은 사람**(공용 PC·분실 노트북·자리 비움)이 "현재 비밀번호" 후보를
//        무제한으로 넣어 볼 수 있다. 맞히면 비밀번호를 바꿔 주인을 쫓아내고,
//        회사 계정이면 **복구용 연락처까지 바꿔 회사 열쇠를 영구히 가져간다.**
//     ② 세션 탈취가 없어도 문제다. **아무 직원이나 자기 계정으로** 틀린 "현재 비밀번호"를 쏟으면
//        요청 1건마다 비밀번호 계산(약 40ms, 작업 스레드 4개 = 분당 약 6,000건이 서버 한계)이 돌아
//        **전 고객사의 로그인·얼굴처리가 함께 밀린다.** C-1에서 공개 문에는 상한을 걸어 뒀는데
//        인증된 이 문에는 아무것도 없었다.
//     ③ 실패마다 접속기록 1행이 쌓여, [보안]-[접속기록]·[로그인 이력] 화면(최신 2000건)에서
//        **진짜 기록을 밀어낸다** = 사고 조사 증거가 지워진다.
//
// 🟢 **이건 "잠금"이 아니다.** H-1이 없앤 피해를 하나도 되살리지 않는다:
//     · DB에 아무것도 쓰지 않는다 (잠금 시각을 남기지 않으므로 "잠긴 상태"가 만들어지지 않는다)
//     · **60초면 저절로 풀린다.** 사람이 풀어 줄 필요가 없고, 영구 차단이 불가능하다
//     · 서버를 재시작하면 초기화된다
//    → 회사 계정이 영영 잠기는 사고(H-1)는 이 방식으로는 일어날 수 없다.
//
// ⚠️ **로그인 문(app/actions/auth.ts)에는 걸지 않았다.** 거기는 로그인 없이 누구나 부를 수 있어,
//    계정별 상한을 걸면 **공격자가 남의 계정 예산을 채워 그 사람을 막을 수 있다**(H-1과 같은 모양의 사고).
//    로그인 문은 lib/public-door.ts(문 전체 분당 상한)와 IP 단위 제한이 담당한다.
//    이 파일은 **이미 로그인한 사람이 자기 계정에 대해서만** 쓰는 창구에만 건다.
//
// 같은 방식의 앞선 사례: lib/public-door.ts(문 단위) · lib/operator-policy.ts(운영자 문).
// 그쪽과 달리 여기는 **계정마다 따로** 세므로, 쓰지 않는 계정의 기록을 버리는 청소가 필요하다(아래).

/** 창(1분). */
const WINDOW_MS = 60 * 1000;

/**
 * 계정 하나가 1분에 비밀번호를 대조받을 수 있는 횟수.
 *  · 사람이 자기 비밀번호를 바꾸다 오타를 내는 횟수는 많아야 두세 번이다. 5회면 넉넉하다.
 *  · 공격자에게는 분당 5회 = 하루 7,200회로 묶인다(예전 잠금이 주던 10분 5회보다는 느슨하지만,
 *    상한 없음과는 비교가 안 된다. 그리고 이 창구는 **로그인한 사람만** 닿을 수 있다).
 */
const MAX_PER_WINDOW = 5;

/**
 * 기억해 둘 계정 수의 상한 — 메모리가 무한히 자라지 않게 한다.
 * 넘으면 창을 벗어난 계정을 전부 청소한다(그래도 넘으면 가장 오래된 것부터 버린다).
 */
const MAX_KEYS = 20_000;

/** 계정별 최근 통과 시각들(밀리초). **통과한 것만** 넣는다 — 거부까지 넣으면 창이 스스로 갱신돼 영구 차단이 된다. */
const hits = new Map<string, number[]>();

/** 창을 벗어난 기록을 버리고, 남은 것이 없으면 그 계정을 아예 잊는다. */
function sweep(now: number) {
  const cutoff = now - WINDOW_MS;
  for (const [key, list] of hits) {
    let i = 0;
    while (i < list.length && list[i] < cutoff) i++;
    if (i > 0) list.splice(0, i);
    if (list.length === 0) hits.delete(key);
  }
}

/**
 * 이 계정이 비밀번호 대조를 한 번 더 받아도 되는가.
 *
 * **시도 자체를 세므로 부르면 1건이 기록된다** — 비밀번호 대조(scrypt) **앞**에서 딱 한 번 부른다.
 *
 * @param userId 대조 대상 계정
 * @returns 받아도 되면 true, 분당 상한을 넘었으면 false(호출부는 대조 없이 거부한다)
 */
export function passwordAttemptAllowed(userId: string, now: number = Date.now()): boolean {
  // 시계가 뒤로 갔으면(NTP 대폭 보정·가상서버 복원) 지금까지의 기록은 의미가 없다.
  //  · 그냥 두면 '미래' 시각이 남아 그 시간만큼 정상 사용자가 막힌다(public-door.ts 검수 중간 3과 같은 함정).
  const list0 = hits.get(userId);
  if (list0 && list0.length > 0 && now < list0[list0.length - 1]) hits.delete(userId);

  if (hits.size > MAX_KEYS) {
    sweep(now);
    // 청소하고도 넘치면(동시 접속 계정이 정말 많은 경우) 가장 오래된 것부터 버린다.
    // 버려진 계정은 예산이 초기화될 뿐이라 **안전한 쪽**으로 틀어진다.
    while (hits.size > MAX_KEYS) {
      const oldest = hits.keys().next();
      if (oldest.done) break;
      hits.delete(oldest.value);
    }
  }

  const list = hits.get(userId) ?? [];
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < list.length && list[i] < cutoff) i++;
  if (i > 0) list.splice(0, i);

  if (list.length >= MAX_PER_WINDOW) {
    if (list.length === 0) hits.delete(userId);
    return false;
  }

  list.push(now);
  hits.set(userId, list);
  return true;
}

/** 지금 적용 중인 분당 상한(운영 확인·테스트용). */
export const PASSWORD_ATTEMPTS_PER_MIN = MAX_PER_WINDOW;
