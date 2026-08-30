// 비밀번호 강도 검사 — **흔한 비밀번호·뻔한 패턴을 막는다** (검수 M-3, 2026-08-31).
//
// 🔴 왜 길이만으로는 안 되나
//    H-1(2026-08-30)에서 **계정 잠금이 비밀번호 찍기를 전혀 막지 못한다**는 것이 실측으로 확인됐다.
//    공격자가 한 계정을 사실상 무제한으로 찍을 수 있다면, 실제로 뚫리는 비밀번호는
//    **"사전에 있는 것"뿐**이다. 그런데 사전에 있는 것들은 길이 규칙을 그냥 통과한다:
//      `1234567890` `aaaaaaaaaa` `qwertyuiop` `password12` — 전부 10자다.
//    → 최소 길이(lib/password-policy.ts PASSWORD_MIN_LEN)와 **함께** 써야 의미가 있다.
//    ⚠️ 한글은 한 글자가 1자로 세어진다 — 낱말 세 개(`노란우산삼겹살`=7자)면 최소 길이에 못 미친다.
//       그래서 안내 문구는 "낱말 **서너** 개"라고 말한다.
//
// 🔴 복잡도 조합(대문자+숫자+특수문자)을 강제하지 않는 이유
//    국제 표준(NIST SP 800-63B)이 2017년 개정 이후 **권장하지 않는다.** 강제하면 사용자가
//    `Gaon2026!` 같은 **예측 가능한 패턴**을 만들어 오히려 사전에 걸린다.
//    대신 길이를 늘리고 **흔한 것을 걸러내는** 방향이 표준이다.
//
// ⚠️ 이 검사의 한계를 정확히 알고 쓸 것
//    · 여기 목록은 **엄선한 것**이지 전 세계 유출 목록(수억 건)이 아니다. 외부 서비스 연동(HIBP 등)은
//      네트워크가 끊기면 **가입이 막히거나(fail-closed) 검사가 통째로 꺼지는(fail-open)** 새 위험을
//      만들어 범위에서 뺐다. 실전 상위 공격은 이 목록+규칙으로 거의 막힌다.
//    · **점수 계산(추측성 판정)을 하지 않는다.** 정확히 일치하거나 명확한 패턴일 때만 막는다.
//      정상 비밀번호가 걸려 사용자가 좌절하는 것이 이 기능 최대의 실패 모드이기 때문이다.
//
// 🔴 **가장 조심할 자리**: 이 검사는 [임시 비밀번호 강제 변경] 화면에도 걸린다.
//    거기서 새 비밀번호를 못 정하면 그 직원은 **다른 화면으로 갈 수도 없어 갇힌다.**
//    그래서 모든 거부 문구는 "왜 안 되는지 + 어떻게 하면 되는지"를 **함께** 말한다.
//
// ⛔ 이 파일에서 비밀번호 값을 **절대 로그로 남기지 않는다**(사규 8).
//
// ⛔ **이 파일에는 import를 넣지 말 것.** `scripts/create-operator.mjs`가 Node로 **직접 불러 쓴다**
//    (운영자 계정도 같은 규칙을 타야 하기 때문). 경로 별칭(`@/lib/...`)이나 확장자 없는 상대경로를
//    하나라도 넣으면 그 스크립트가 즉시 깨진다 — `lib/login-policy.ts`와 같은 제약이다.

/** 비밀번호 주인에 대해 아는 것 — 이 값들이 비밀번호에 들어 있으면 막는다. */
export type PasswordOwnerHints = {
  email?: string | null;
  name?: string | null;
  companyName?: string | null;
};

/**
 * 모든 거부 문구 끝에 붙는 안내 — "그럼 어떻게 하라는 건지"를 반드시 알려준다.
 *
 * ⚠️ **여기 적는 예시는 반드시 최소 길이를 넘겨야 한다.** 한글은 한 글자가 1자로 세어져서
 *    낱말 세 개(예: `노란우산삼겹살` = 7자)면 최소 길이에 못 미치기 쉽다.
 *    안내대로 따라 했는데 거부당하는 것이 이 기능 최대의 실패다 — 예시를 바꿀 때 글자 수를 반드시 세어 볼 것.
 *    (실제로 처음에 7자 예시를 넣었다가 검증에서 잡혔다)
 */
const ADVICE = " 서로 관련 없는 낱말 서너 개를 이어 붙이면 외우기도 쉽고 안전합니다. (예: 노란우산삼겹살볶음밥)";

/**
 * 흔히 쓰이는 비밀번호 — **엄선 목록**.
 *  · 세계 공통으로 가장 많이 쓰이는 것 + **국내 사전에 반드시 들어 있는 한글 자판 패턴**.
 *    (한글 자판 패턴 예: `dkssud`=안녕, `tkfkdgo`=사랑해, `rkskek`=가나다, `qlalfqjsgh`=비밀번호)
 *  · 전부 소문자로 적는다. 비교할 때 입력값도 소문자로 바꾼다.
 *  · 새 항목을 넣을 때는 **6자 이상**만 넣는다(짧은 낱말은 부분 일치로 오탐을 만든다).
 */
const COMMON = new Set<string>([
  // ── 숫자·기본 ──
  "123456", "1234567", "12345678", "123456789", "1234567890", "987654321", "654321",
  "111111", "000000", "121212", "112233", "123123", "123321", "666666", "888888", "999999",
  "159753", "147258", "789456", "102030",
  // ── 영어 흔한 낱말 ──
  "password", "password1", "password123", "passw0rd", "p@ssw0rd", "letmein", "welcome",
  "iloveyou", "sunshine", "princess", "football", "baseball", "monkey1", "dragon1",
  "superman", "batman1", "trustno1", "whatever", "freedom1", "starwars", "computer",
  "michael", "jennifer", "jordan23", "charlie", "shadow1", "master1", "hunter2",
  "cookie1", "pepper1", "ashley1", "bailey1", "soccer1", "hockey1", "ranger1",
  // ── 키보드 ──
  "qwerty", "qwerty123", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm",
  "qwer1234", "asdf1234", "qwer!@#$", "asdf!@#$", "1q2w3e4r", "1q2w3e4r5t", "q1w2e3r4",
  "1qaz2wsx", "zaq12wsx", "qazwsx", "qweasd", "qweasdzxc", "1234qwer", "qwe123",
  // ── 한글 자판(두벌식) — 국내 사전 필수 ──
  "dkssud",        // 안녕
  "dkssudgktpdy",  // 안녕하세요
  "tkfkdgo",       // 사랑해
  "tkfkdgks",      // 사랑한
  "rkskek",        // 가나다
  "gksrnr",        // 한국
  "qlalfqjsgh",    // 비밀번호
  "dnfl",          // 우리
  "dhsmf",         // 오늘
  "wkdrbs",        // 장근(흔한 이름 조각)
  "rlaruddnf",     // 김경우류(이름 패턴)
  // ── 국내 서비스·브랜드 ──
  "samsung", "google1", "facebook", "naver123", "kakao123", "daum1234", "hyundai",
  // ── 이 서비스와 관련된 낱말(전용 사전이 되기 쉽다) ──
  "gaontech", "newgaon", "geuntae", "attendance", "chulgeun",
  // ── 🔴 안내 문구(ADVICE)에 쓰는 예시 — **반드시 여기 넣어 막는다** (후속 검수 중간 4) ──
  //    화면에 그대로 노출되는 값이라, 예시를 그대로 입력하는 사람이 반드시 나온다.
  //    그 순간 그 계정의 비밀번호는 **공개된 값**이 된다(H-1로 잠금이 없어 1회 시도로 뚫린다).
  //    ⚠️ ADVICE의 예시를 바꾸면 이 줄도 함께 바꿀 것.
  "노란우산삼겹살볶음밥",
  // ── 한글 IME로 **직접 친** 흔한 패턴(후속 검수 경미 1) ──
  //    위 로마자 자판 패턴(dkssud 등)은 영문 상태로 친 경우다. 실제로는 한글로 그냥 치는 사람이 더 많다.
  "가나다라마바사", "가나다라마바사아자차", "안녕하세요", "안녕하세요반갑습니다",
  "사랑해요", "우리집강아지", "비밀번호", "비밀번호입니다", "생일축하합니다",
]);

/** 순서대로 이어 쓴 것을 잡기 위한 기준 문자열(뒤집은 것도 함께 본다). */
const SEQUENCES = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
/** 몇 글자 이상 이어져야 막을 것인가. 4는 오탐이 잦아 5로 둔다. */
const SEQ_RUN = 5;

/**
 * 검사할 최대 길이 — 이보다 길면 검사하지 않는다(안전판, 아래 checkPasswordStrength 주석 참조).
 * 정책 상한(200자)보다 넉넉히 잡아, 정상 입력이 여기 걸리는 일은 없다.
 */
const SCAN_LIMIT = 1000;

/**
 * 회사 이름에서 빼야 하는 낱말 — 거의 모든 회사에 붙어 있어 그대로 두면 남의 회사까지 막는다.
 * (`주식회사 나라`인 회사에서 `우리회사주식회사만세`가 거부됐다 — 후속 검수 중간 1)
 */
const COMPANY_STOPWORDS = new Set(["주식회사", "유한회사", "합자회사", "합명회사", "재단법인", "사단법인", "co", "ltd", "inc", "corp", "com"]);

/** 힌트 문자열에서 검사할 조각을 뽑는다. 3글자 미만과 회사 불용어는 버린다. */
function hintTokens(...values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    for (const t of v.toLowerCase().split(/[^0-9a-z가-힣]+/)) {
      if (t.length >= 3 && !COMPANY_STOPWORDS.has(t)) out.push(t);
    }
  }
  return out;
}

/** 순서대로 이어 쓴 부분이 있는가. */
function hasSequentialRun(lower: string): boolean {
  for (const src of SEQUENCES) {
    const rev = src.split("").reverse().join("");
    for (let i = 0; i + SEQ_RUN <= lower.length; i++) {
      const win = lower.slice(i, i + SEQ_RUN);
      if (src.includes(win) || rev.includes(win)) return true;
    }
  }
  return false;
}

/** 흔한 비밀번호인가 — 정확히 같거나, 앞뒤에 숫자·기호만 조금 붙인 형태까지 본다. */
function isCommon(lower: string): boolean {
  if (COMMON.has(lower)) return true;
  // `password2026` 처럼 뒤(또는 앞)에 숫자·기호만 덧붙인 형태
  const trimmed = lower.replace(/^[^a-z가-힣]+/, "").replace(/[^a-z가-힣]+$/, "");
  if (trimmed.length >= 4 && COMMON.has(trimmed)) return true;
  // 흔한 낱말이 비밀번호의 상당 부분(40% 이상)을 차지하는 형태
  //  · 0.6이었을 때 `Passw0rd!2026Gaon`(passw0rd가 47%)이 통과했다(후속 검수 경미 2).
  //  · COMMON 항목이 6자 이상이라, 0.4로 낮춰도 짧은 낱말이 긴 비밀번호를 잡는 오탐은 생기지 않는다.
  for (const c of COMMON) {
    if (c.length >= lower.length * 0.4 && lower.includes(c)) return true;
  }
  return false;
}

/**
 * 비밀번호가 쓸 만한가.
 *
 * @returns 통과하면 `null`. 막히면 **화면에 그대로 보여줄 한국어 문구**를 돌려준다.
 *          (길이 검사는 여기서 하지 않는다 — 호출부가 `PASSWORD_MIN_LEN`으로 먼저 본다)
 */
export function checkPasswordStrength(password: string, hints: PasswordOwnerHints = {}): string | null {
  // 🔴 안전판 — **호출부는 반드시 길이 상한(PASSWORD_MAX_LEN, 200자)을 먼저 검사해야 한다**(후속 검수 치명 1).
  //    그 약속이 깨지면 서버액션 본문 한도(4MB)만큼 긴 값이 여기 들어와 **한 번에 1.6초**가 걸리고,
  //    Node는 단일 스레드라 그동안 **전 고객사의 요청이 멈춘다.** 여기서 한 번 더 막아 둔다.
  //    (통과로 돌려주는 이유: 어차피 호출부의 길이 상한이 거부한다. 여기서는 CPU만 아끼면 된다)
  if (password.length > SCAN_LIMIT) return null;

  const lower = password.toLowerCase();

  // ① 숫자만 — 생일·전화번호가 가장 먼저 시도되는 값이다. 10자리여도 약하다.
  if (/^[0-9]+$/.test(password)) {
    return "숫자만으로는 정할 수 없습니다. 생일·전화번호가 가장 먼저 시도되는 값입니다." + ADVICE;
  }

  // ①-b 긴 숫자 덩어리가 대부분을 차지한다 — `19900101한글` 처럼 **생년월일·전화번호에 꼬리표만 붙인** 형태.
  //     ①(숫자만)을 피하려고 글자 두어 개를 붙이는 것이 가장 흔한 우회다.
  //     기준: 6자리 이상 숫자 덩어리가 전체의 절반 이상. (`한라산등반2026가자`는 4자리·40%라 통과한다)
  const longestDigitRun = (password.match(/[0-9]+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  if (longestDigitRun >= 6 && longestDigitRun >= password.length * 0.5) {
    return "생일·전화번호처럼 보이는 긴 숫자가 대부분을 차지합니다." + ADVICE;
  }

  // ② 쓰인 글자 종류가 너무 적다 — `1212121212` `aaaaaaaaaa` 같은 것.
  if (new Set(lower).size <= 4) {
    return "쓰인 글자 종류가 너무 적습니다." + ADVICE;
  }

  // ③ 같은 글자를 4번 이상 잇달아 썼다.
  if (/(.)\1{3,}/.test(lower)) {
    return "같은 글자를 4번 이상 잇달아 쓸 수 없습니다." + ADVICE;
  }

  // ④ 키보드·숫자를 순서대로 이어 썼다 — `12345` `qwert` `abcde`.
  if (hasSequentialRun(lower)) {
    return "키보드나 숫자를 순서대로 이어 쓴 부분이 있습니다. 가장 먼저 시도되는 형태입니다." + ADVICE;
  }

  // ⑤ 널리 알려진 비밀번호.
  if (isCommon(lower)) {
    return "너무 흔히 쓰이는 비밀번호입니다." + ADVICE;
  }

  // ⑥ 본인·회사 정보가 **비밀번호의 상당 부분**을 차지한다 — 표적 공격이 가장 먼저 시도하는 조합.
  //
  // 🔴 왜 "들어 있으면 무조건"이 아니라 비중(40%)을 보나 — 안 그러면 정상 비밀번호가 무더기로 막힌다.
  //    한국인 성씨 로마자가 흔한 영단어 **안에 그대로 들어 있기** 때문이다(후속 검수 중간 1, 13종 실측):
  //      park → s`park`ling / moon → `moon`light / son → rea`son` / min → vita`min`
  //      han → t`han`kyou / seo → `seo`ul / kim → `kim`chi / cho → `cho`colate / nam → my`nam`e
  //    `sparkling아이스티`를 쓰려는 박씨 직원에게 "이메일 아이디가 들어 있습니다"라고 답하면
  //    그 사람은 무슨 소린지 알 수 없다. **이게 이 기능 최대의 실패 모드다.**
  //    ⚠️ 3글자 하한을 4글자로 올려도 안 고쳐진다 — park·moon·song·shin·name이 전부 4글자다.
  //       하한이 아니라 **비중**으로 판정해야 한다.
  const local = (hints.email ?? "").split("@")[0];
  for (const t of hintTokens(local, hints.name, hints.companyName)) {
    if (t.length >= lower.length * 0.4 && lower.includes(t)) {
      return "이메일 아이디·이름·회사 이름이 들어 있습니다. 그 사람을 노린 공격이 가장 먼저 시도하는 조합입니다." + ADVICE;
    }
  }

  return null;
}
