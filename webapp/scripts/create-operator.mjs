// 운영자(본사) 계정 만들기 / 비밀번호 바꾸기 — **서버에서 직접 실행하는 명령**이다.
//
// 사용법 (webapp 폴더에서):
//   node scripts/create-operator.mjs "이메일" "비밀번호" "이름"          ← 새 계정
//   node scripts/create-operator.mjs --reset "이메일" "새 비밀번호"      ← 비밀번호 바꾸기
//   node scripts/create-operator.mjs --email "지금 이메일" "새 이메일"    ← 아이디 바꾸기
//   node scripts/create-operator.mjs --list                            ← 계정 목록(잠금 상태까지)
//   node scripts/create-operator.mjs --unlock "이메일"                  ← 잠금만 풀기
//   node scripts/create-operator.mjs --off "이메일"                     ← 계정 끄기(지우지 않는다)
//   node scripts/create-operator.mjs --on  "이메일"                     ← 다시 켜기
//
// 🔴 화면(웹)에서 운영자 계정을 만들 수 있게 하지 않는다. **일부러 그렇다.**
//    회원사 전체를 보는 계정을 만드는 통로는 그 자체가 가장 좋은 공격 표적이다.
//    "서버에 직접 들어올 수 있는 사람만 만들 수 있다"는 것이 이 계정의 마지막 방어선이다.
//    같은 이유로 비밀번호 재설정 창구도 없다 — 잊으면 이 명령으로 다시 정한다.
//
// 🔴 비밀번호 암호화를 여기서 **다시 구현하지 않는다.** 실제 앱이 쓰는 lib/password.ts 를 그대로
//    불러 쓴다. 따로 구현하면 나중에 앱 쪽 방식이 바뀌는 순간 **로그인할 수 없는 계정**이
//    조용히 만들어진다(그리고 재설정 창구가 없어 되돌릴 방법도 없다).
//    · Node 24는 .ts 파일을 그대로 불러올 수 있어 가능하다(확인: Node v24.16.0).
//    · 실행하면 "Module type ... Reparsing as ES module" 경고가 한 줄 뜨는데 **정상**이다.
//      없애려면 package.json에 "type":"module"을 넣어야 하지만, 그건 Next 설정 파일들까지
//      영향을 받는 변경이라 하지 않는다.
//
// ⚠️ 비밀번호는 명령에 그대로 적히므로 **PowerShell 명령 기록에 남는다.** 이 계정을 만든 뒤
//    기록을 지우거나(Clear-History), 남아도 되는 PC에서만 실행할 것.
//    ⛔ 비밀번호를 소스·문서·커밋에 적지 않는다(사규 8).
import { PrismaClient } from "@prisma/client";

// 앱과 **같은** 암호화 함수·정책 상수를 불러온다. (여기서 다시 구현하거나 숫자를 다시 적으면 갈린다)
//  ⚠️ 정적 import 대신 이렇게 감싼 이유(검수 E-11): `.ts` 파일을 그대로 불러오는 것은 Node 22.6
//     이상에서만 된다. 예전 Node에서는 `Unknown file extension ".ts"`로 죽는데, 그 메시지만 보면
//     **운영자 계정을 만들 방법이 없는 상황에서 원인을 짐작할 수 없다.** 그래서 사람 말로 알려준다.
//  ⚠️ 아래 **네 파일**에 `@/lib/...` 형태(경로 별칭) import가 생기면 이 스크립트가 즉시 깨진다 —
//     Node는 그 별칭을 모른다. 게다가 죽을 때 "Node 22.6 이상이 필요합니다"라는 **엉뚱한 메시지**가
//     나와 원인을 짐작하기 어렵다. 이 파일들에 손댈 때 반드시 기억할 것:
//       `../lib/password.ts` · `../lib/login-policy.ts` · `../lib/password-strength.ts` ·
//       `../lib/password-policy.ts`
//     (2026-11-20에 뒤의 두 개가 늘었는데 이 목록은 그대로여서 함께 고쳤다.)
let hashPassword, EMAIL_MAX_LEN, PASSWORD_MAX_LEN, checkPasswordStrength, OPERATOR_PASSWORD_MIN_LEN;
try {
  ({ hashPassword } = await import("../lib/password.ts"));
  ({ EMAIL_MAX_LEN, PASSWORD_MAX_LEN } = await import("../lib/login-policy.ts"));
  // 🔴 [검수 M-3 후속 중간 2] 운영자 계정도 **고객사와 같은 강도 규칙**을 탄다.
  //    예전에는 길이 12자만 봐서, 직원은 `password12`를 거부당하는데
  //    **전 회원사 데이터를 보는 유일한 계정**은 `password1234`를 쓸 수 있었다.
  //    ⚠️ `../lib/password-strength.ts`는 **import가 하나도 없어야** 여기서 불린다. 그쪽 주석 참조.
  ({ checkPasswordStrength } = await import("../lib/password-strength.ts"));
  // 운영자 최소 길이는 **앱과 같은 상수**를 본다(2026-11-20에 하나로 모았다 — 검수 치명 1).
  //  ⚠️ `../lib/password-policy.ts`도 import가 하나도 없어야 여기서 불린다(그 파일 주석 참조).
  ({ OPERATOR_PASSWORD_MIN_LEN } = await import("../lib/password-policy.ts"));
} catch (e) {
  console.error("✖ 앱 코드를 불러오지 못했습니다.");
  console.error(`  지금 Node 버전: ${process.version} — 이 명령은 Node 22.6 이상이 필요합니다.`);
  console.error("  (원본 오류: " + (e instanceof Error ? e.message : String(e)) + ")");
  process.exit(1);
}

// 🔴 최소 길이는 고객사(10자)보다 **높다**(검수 M-7). 이유·숫자는 앱과 같은 한 곳에 있다:
//    `lib/password-policy.ts`의 OPERATOR_PASSWORD_MIN_LEN.
//    ⚠️ 여기에 숫자를 다시 적지 말 것 — 2026-11-20에 웹 [내 계정] 화면이 고객사용 10자를 쓰는
//       바람에 "명령은 12자, 화면은 10자"로 갈렸다(검수 치명 1). 그래서 상수 하나로 모았다.
//    ⚠️ 30분 유휴 때문에 하루에 몇 번씩 다시 입력하게 되는데, 그 불편이 "짧고 뻔한 비번"을
//       유도한다. 그래서 길이는 숫자로 강제하고, 아래에서 통문장(띄어쓰기 포함)을 권한다.
const PASSWORD_MIN_LEN = OPERATOR_PASSWORD_MIN_LEN;

const prisma = new PrismaClient();

// ⚠️ 이 파일은 `.mjs`라 **타입 표기를 쓸 수 없다**(Node가 .mjs는 타입을 걷어내지 않는다 —
//    실제로 `function usage(): never`라고 썼다가 문법 오류가 났다). 불러오는 `../lib/*.ts` 쪽은
//    Node 24가 타입을 걷어내므로 그대로 동작한다. 확장자를 `.mts`로 바꾸면 이 파일도 타입을 쓸 수
//    있지만, 그러면 `npx tsc --noEmit`이 `.ts` 확장자 import를 오류로 잡는다(tsconfig include에 .mts가 있다).
//    → 기존 scripts/*.mjs 관례에 맞춘다.
function usage() {
  console.log(`
운영자 계정 관리

  node scripts/create-operator.mjs "이메일" "비밀번호" "이름"        새 계정 만들기
  node scripts/create-operator.mjs --reset "이메일" "새 비밀번호"    비밀번호 바꾸기
  node scripts/create-operator.mjs --email "지금 이메일" "새 이메일"  아이디 바꾸기
  node scripts/create-operator.mjs --list                          계정 목록(잠금 상태까지)
  node scripts/create-operator.mjs --unlock "이메일"                잠금만 풀기
  node scripts/create-operator.mjs --off "이메일"                   계정 끄기
  node scripts/create-operator.mjs --on  "이메일"                   계정 켜기

  ※ 비밀번호는 ${PASSWORD_MIN_LEN}자 이상. 기억하기 쉬운 통문장을 권합니다(띄어쓰기도 됩니다).

  ※ 값을 **환경변수로** 받는 모드도 있습니다(도우미 프로그램용 — 비밀번호가 명령줄에
     남지 않고, 따옴표가 섞여도 값이 변하지 않습니다):
       --reset-env   OP_EMAIL + OP_NEW_PW
       --email-env   OP_EMAIL + OP_NEW_EMAIL
       --create-env  OP_EMAIL + OP_NEW_PW + OP_NAME
       --unlock-env / --off-env / --on-env   OP_EMAIL
     쉬운 사용법: 저장소 맨 위의 **운영자_계정관리.bat** 을 더블클릭하세요.
`);
  process.exit(1);
}

/** 로그인 화면이 받아주는 이메일인가 — ASCII만. */
//  🔴 왜 필요한가(검수 E-7): 로그인 화면의 입력칸은 <input type="email">이라 브라우저가
//     한글이 든 주소(예: 운영자@가온.kr)의 제출을 **아예 막는다.** 여기서 통과시키면
//     "만들어졌지만 로그인 화면에서 제출조차 안 되는 계정"이 생기고, 재설정 창구가 없어
//     서버에서 다시 만드는 수밖에 없다.
function isAsciiEmail(v) {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]+$/.test(v);
}

/**
 * 로그인 화면이 **실제로** 받아주는 글자만 쓰였는가.
 *
 * 🔴 왜 따로 필요한가(2026-11-20 검수 중간 2): 위 isAsciiEmail 은 "보이는 ASCII 글자"면
 *    전부 통과시킨다. 그런데 따옴표(")는 ASCII라서 통과하는데도 <input type="email"> 은
 *    거부한다. 실제로 `a"b@x.com` 이 검사를 그대로 통과해 DB 조회까지 내려갔다(실측).
 *    메일·메신저에서 주소를 복사하면 따옴표가 함께 붙어오는 일이 흔해서, 그대로 두면
 *    **아이디 변경(--email)으로 유일한 본사 계정이 로그인 불가 상태가 된다.**
 *    운영자에게는 비밀번호·아이디 찾기 창구가 없으므로 웹으로 되돌릴 수 없다.
 *
 * 이 식은 HTML 표준이 type="email" 검사에 쓰라고 정해 둔 바로 그 식이다. 즉 기준을
 * 우리가 새로 만들지 않고 **브라우저와 같은 것을 본다.** 작은따옴표·&·^ 처럼 표준이
 * 허용하는 글자는 여기서도 통과시킨다(멋대로 더 조이면 쓸 수 있는 주소를 막는다).
 */
const LOGIN_ACCEPTS_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * 이메일(로그인 아이디)이 쓸 수 있는 값인지 보고, 아니면 이유를 말하고 끝낸다.
 *
 * 🔴 **계정을 만들 때와 아이디를 바꿀 때가 같은 기준을 써야 한다**(2026-11-20에 하나로 묶었다).
 *    한쪽만 느슨하면 그 길로 **"앱 로그인이 받아주지 않는 주소"**를 가진 계정이 만들어지고,
 *    운영자에게는 재설정 창구가 없어 서버에 들어오지 않고는 되돌릴 수 없다.
 */
/** 지금 이 명령이 보고 있는 DB가 어디인지 사람 말로. (개발 PC인지 운영 서버인지 구분하려고) */
function dbLocation() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return "알 수 없음 (DATABASE_URL 없음)";
  const file = url.replace(/^file:/, "");
  // 운영은 Docker 안의 /data/db/... 를 쓴다(deploy/server). 개발 PC는 prisma/dev.db.
  const where = file.startsWith("/data/") ? "운영 서버" : "이 PC(개발용)";
  return `${where} — ${file}`;
}

function checkEmailOrExit(email) {
  // 🔴 **로그인 화면과 같은 수준으로 조인다**(검수 중간 1). 로그인 입력칸은 `type="email"`이라
  //    브라우저가 `abcd@`·`@abcd`·`a b@c.com` 같은 주소는 **제출 자체를 막는다.** 예전처럼
  //    "@가 있고 5자 이상"만 보면, 오타 한 번(`...co,kr`·도메인 빠뜨림·공백 끼임)으로
  //    **그 계정으로 웹에 영영 못 들어가는 상태**가 된다(운영자는 재설정 창구가 없다).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error("✖ 이메일 형식이 올바르지 않습니다. (예: hong@gaon.co.kr)");
    console.error("  로그인 화면이 받아주지 않는 주소로 바꾸면 그 계정으로 들어갈 수 없습니다.");
    process.exit(1);
  }
  if (!isAsciiEmail(email)) {
    console.error("✖ 이메일에 한글·특수문자가 들어 있습니다. 로그인 화면이 받아주지 않으므로 영문 주소를 써주세요.");
    process.exit(1);
  }
  // 🔴 ASCII 라서 위를 통과하지만 로그인 화면은 거부하는 글자(따옴표 등)를 막는다.
  if (!LOGIN_ACCEPTS_EMAIL.test(email)) {
    console.error('✖ 로그인 화면이 받아주지 않는 글자가 들어 있습니다(따옴표 " 같은 것).');
    console.error("  메일·메신저에서 주소를 복사할 때 따라온 따옴표가 가장 흔한 원인입니다.");
    console.error("  주소만 남기고 다시 입력해주세요. (예: hong@gaon.co.kr)");
    process.exit(1);
  }
  // 🔴 앱의 로그인이 이 길이를 넘으면 **비밀번호를 보기도 전에 거부**한다.
  //    여기서 막지 않으면 그 순간 "로그인할 수 없는 운영자 계정"이 만들어진다
  //    (재설정 창구가 없으므로 되돌릴 방법도 없다 — 고객사 쪽 검수 치명 1과 같은 함정).
  if (email.length > EMAIL_MAX_LEN) {
    console.error(`✖ 이메일은 ${EMAIL_MAX_LEN}자 이하여야 합니다.`);
    process.exit(1);
  }
}

async function main() {
  let [a, b, c] = process.argv.slice(2);

  // ── 값을 **환경변수로** 받는 모드 (2026-11-20, 검수 치명 2) ──────────────────
  //  🔴 왜 필요한가: 비밀번호·아이디를 명령 인자로 주면 두 가지가 깨진다.
  //    ① **따옴표가 섞이면 값이 달라진다.** PowerShell이 `"`를 먹어서, 사장님이 친 것과
  //       **다른 비밀번호가 저장된다**(실측: `ab"cd 1234567` → `abcd 1234567`). 입력이 화면에
  //       보이지 않으니 원인을 짐작할 수도 없고, 다시 해도 같은 결과라 빠져나올 수 없다.
  //    ② **실행 중 프로세스 목록에 비밀번호가 그대로 보인다**(Get-CimInstance Win32_Process).
  //       `deploy/server/README.md`가 "비밀번호가 들어가는 명령은 명령줄에 적지 않는다"고
  //       못박은 규칙을 정면으로 어긴다.
  //  → 도우미(운영자_계정관리.bat)는 이 모드만 쓴다. 사람이 손으로 칠 때는 기존 방식 그대로.
  //  ⚠️ 아래는 **값을 바꿔 끼울 뿐** 그 뒤 처리는 기존 분기를 그대로 탄다(검증·중복검사 동일).
  if (a === "--reset-env") {
    a = "--reset";
    b = process.env.OP_EMAIL ?? "";
    c = process.env.OP_NEW_PW ?? "";
  } else if (a === "--email-env") {
    a = "--email";
    b = process.env.OP_EMAIL ?? "";
    c = process.env.OP_NEW_EMAIL ?? "";
  } else if (a === "--create-env") {
    a = process.env.OP_EMAIL ?? "";
    b = process.env.OP_NEW_PW ?? "";
    c = process.env.OP_NAME ?? "";
  } else if (a === "--unlock-env" || a === "--off-env" || a === "--on-env") {
    a = a.replace("-env", "");
    b = process.env.OP_EMAIL ?? "";
  }

  if (!a) usage();

  // ── 목록 보기 ──
  if (a === "--list") {
    const rows = await prisma.operator.findMany({ orderBy: { createdAt: "asc" } });
    // 🔴 **어느 DB를 보고 있는지 먼저 밝힌다**(검수 치명 1). 이 명령은 실행한 곳의 DB만 본다.
    //    운영 서버(attend.newgaon.com)의 계정은 그 서버 안에서
    //    `docker exec attendance-app node scripts/create-operator.mjs ...` 로 고친다
    //    (deploy/server/README.md). 이 줄이 없으면 개발 PC에서 고쳐 놓고 "운영도 바뀐 줄"
    //    아는 사고가 난다 — 화면에는 성공이라 뜨는데 운영은 그대로인 상태가 가장 위험하다.
    //
    //  🔴 이 줄은 **계정 0건 검사보다 먼저** 와야 한다(2026-11-20 검수 중간 2). 전에는 0건이면
    //     여기 오기 전에 return 해서 DB 위치가 한 번도 안 찍혔다. 그런데 "계정 0건"은 바로
    //     **첫 운영자를 만드는 상황**이고, 계정관리 도구 5번(새 계정)은 화면을 지운 뒤 이 명령으로
    //     위치를 보여 주는 구조라 — 가장 필요한 지점에서만 안내가 사라지는 셈이었다.
    console.log(`지금 보는 곳: ${dbLocation()}`);
    if (rows.length === 0) {
      console.log("운영자 계정이 아직 없습니다.");
      return;
    }
    console.log(`운영자 계정 ${rows.length}개`);
    const now = new Date();
    for (const r of rows) {
      const state = r.active ? "사용중" : "중지";
      const last = r.lastLoginAt ? r.lastLoginAt.toLocaleString("ko-KR") : "로그인 이력 없음";
      // 🔴 잠금 상태를 함께 보여준다(검수 E-4). 안 보여주면 잠금 때문에 못 들어가는 상황에서
      //    목록에는 [사용중]으로만 보여 **원인을 알 수 없다**(재설정 창구가 없어 더 답답해진다).
      const locked = r.lockedUntil && r.lockedUntil > now
        ? `  ⚠ 잠김(약 ${Math.max(1, Math.ceil((r.lockedUntil.getTime() - now.getTime()) / 60000))}분 남음 — --unlock 으로 풀 수 있음)`
        : r.failedLoginCount > 0
          ? `  (연속 실패 ${r.failedLoginCount}회)`
          : "";
      console.log(`  · ${r.email}  (${r.name})  [${state}]  마지막 로그인: ${last}${locked}`);
    }
    return;
  }

  // ── 잠금 풀기 ──
  //  🔴 왜 별도 명령이 필요한가(검수 M-6): 원래는 비밀번호를 다시 정하는 것만이 유일한 해제 방법이었다.
  //     그런데 잠금은 **남이 틀려서도** 걸린다(이메일은 추측하기 쉽다). 잠겼을 때마다 비밀번호를
  //     새로 정하게 만들면, 사장님이 쓰던 비밀번호를 계속 바꿔야 한다. 잠금만 푸는 길을 따로 둔다.
  if (a === "--unlock") {
    const email = (b ?? "").trim().toLowerCase();
    if (!email) usage();
    const found = await prisma.operator.findUnique({ where: { email } });
    if (!found) {
      console.error(`✖ 그런 운영자 계정이 없습니다: ${email}`);
      process.exit(1);
    }
    await prisma.operator.update({ where: { email }, data: { failedLoginCount: 0, lockedUntil: null } });
    console.log(`✔ 잠금을 풀었습니다: ${email}`);
    if (!found.active) console.log("  ⚠ 다만 이 계정은 지금 **꺼져 있습니다.** --on 으로 켜야 로그인됩니다.");
    return;
  }

  // ── 끄기 / 켜기 ──
  if (a === "--off" || a === "--on") {
    const email = (b ?? "").trim().toLowerCase();
    if (!email) usage();
    const active = a === "--on";
    const found = await prisma.operator.findUnique({ where: { email } });
    if (!found) {
      console.error(`✖ 그런 운영자 계정이 없습니다: ${email}`);
      process.exit(1);
    }
    // 🔴 **마지막 남은 쓸 수 있는 계정은 끄지 못하게 막는다**(2026-11-20 사장님 승인, 검수 범위 밖 지적).
    //    끄면 /operator 로 들어갈 길이 0이 된다. 운영자에게는 비밀번호·아이디 찾기 창구가 없어서
    //    웹으로는 되돌릴 방법이 전혀 없고, 운영 서버라면 서버에 들어가 `docker exec` 를 해야 한다.
    //    "끄기"는 흔히 4번(잠금 풀기)을 누르려다 잘못 들어와 벌어지는 실수라 더 막아 둘 값어치가 있다.
    //  · 이미 꺼져 있는 계정을 또 끄는 것은 상태가 변하지 않으므로 검사하지 않는다(`found.active`).
    //  · 못 끄게 해서 생기는 손해(새 계정을 먼저 만들어야 함)보다 들어갈 길이 0이 되는 손해가 훨씬 크다.
    if (!active && found.active) {
      const liveCount = await prisma.operator.count({ where: { active: true } });
      if (liveCount <= 1) {
        console.error(`✖ 지금 쓸 수 있는 운영자 계정이 이것 하나뿐이라 끌 수 없습니다: ${email}`);
        console.error("  끄면 운영자 화면에 들어갈 길이 없어지고, 웹에는 되돌릴 창구가 없습니다.");
        console.error("  먼저 다른 운영자 계정을 만든 뒤(계정관리 도구 5번) 끄세요.");
        process.exit(1);
      }
    }
    await prisma.operator.update({ where: { email }, data: { active } });
    // 끌 때는 열려 있던 로그인도 함께 끊는다 — 끄기가 즉시 효력을 갖게.
    //  (세션 조회에서도 active를 매번 확인하지만, 여기서 지우면 DB에 남지도 않는다)
    if (!active) {
      const gone = await prisma.operatorSession.deleteMany({ where: { operatorId: found.id } });
      console.log(`✔ 계정을 껐습니다: ${email} (열려 있던 로그인 ${gone.count}건 해제)`);
    } else {
      console.log(`✔ 계정을 켰습니다: ${email}`);
    }
    return;
  }

  // ── 아이디(이메일) 바꾸기 ── (2026-11-20 사장님 요청)
  //  🔴 비밀번호는 건드리지 않는다. 아이디만 갈아끼운다.
  //  🔴 **열려 있던 로그인은 전부 끊는다.** 로그인 아이디가 바뀌는 것은 계정의 신원이 바뀌는
  //     사건이라, 바꾸기 전에 열어 둔 창이 살아 있으면 "누가 무엇으로 들어와 있는지"가 흐려진다
  //     (--off 가 세션을 지우는 것과 같은 이유).
  if (a === "--email") {
    const oldEmail = (b ?? "").trim().toLowerCase();
    const newEmail = (c ?? "").trim().toLowerCase();
    if (!oldEmail || !newEmail) usage();
    checkEmailOrExit(newEmail);
    if (oldEmail === newEmail) {
      console.error("✖ 지금 아이디와 같습니다. 바꿀 내용이 없습니다.");
      process.exit(1);
    }
    const found = await prisma.operator.findUnique({ where: { email: oldEmail } });
    if (!found) {
      console.error(`✖ 그런 운영자 계정이 없습니다: ${oldEmail}`);
      console.error("  (지금 있는 계정은  --list  로 볼 수 있습니다)");
      process.exit(1);
    }
    const taken = await prisma.operator.findUnique({ where: { email: newEmail } });
    if (taken) {
      console.error(`✖ 그 아이디는 이미 다른 운영자가 쓰고 있습니다: ${newEmail}`);
      process.exit(1);
    }
    // 아이디 교체 + 세션 정리 + 기록을 **한 묶음**으로(둘 중 하나만 된 상태를 만들지 않는다).
    //  잠금·실패 횟수도 함께 정리한다 — 옛 아이디로 쌓인 실패 흔적을 새 아이디가 물려받을 이유가 없다.
    //  🔴 접속기록을 남기는 이유(검수 중간 3): **계정의 신원이 바뀌는 사건**인데 [운영자 접속
    //     기록] 화면에 흔적이 0이면, 월 1회 기록 점검에서 이 일이 보이지 않는다.
    //     companyId·userId 는 **반드시 null** — 그래야 고객사 화면으로 새지 않는다
    //     (app/actions/operator.ts 의 logOperator 와 같은 규칙).
    await prisma.$transaction([
      prisma.operator.update({
        where: { id: found.id },
        data: { email: newEmail, failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.operatorSession.deleteMany({ where: { operatorId: found.id } }),
      prisma.accessEvent.create({
        data: {
          companyId: null,
          userId: null,
          actorName: `운영자 ${found.name}`,
          emailTried: newEmail,
          kind: "config",
          result: "success",
          ip: null,
          userAgent: null,
          device: "서버 명령",
          meta: `operator_email_change(이전 아이디 ${oldEmail})`,
        },
      }),
    ]);
    console.log(`✔ 아이디를 바꿨습니다: ${found.name} — ${oldEmail} → ${newEmail}`);
    console.log("  · 비밀번호는 그대로입니다.");
    console.log("  · 열려 있던 로그인은 모두 끊겼습니다. 새 아이디로 다시 로그인하세요.");
    if (!found.active) console.log("  ⚠ 다만 이 계정은 지금 **꺼져 있습니다.** --on 으로 켜야 로그인됩니다.");
    return;
  }

  // ── 만들기 / 비밀번호 변경 ──
  //  🔴 기존 계정의 비밀번호를 바꿀 때는 **--reset 을 반드시 붙여야 한다**(검수 E-6).
  //     예전에는 이메일만 맞으면 조용히 덮어썼다. 운영자가 두 명일 때 이메일을 잘못 적으면
  //     **동료의 비밀번호가 소리 없이 바뀌고 그 사람의 로그인이 전부 끊긴다.** 재설정 창구가
  //     없으므로 그 동료는 서버에 들어오지 않고는 복구할 수 없다. 실수 한 번의 대가가 너무 크다.
  const isReset = a === "--reset";
  const email = (isReset ? (b ?? "") : a).trim().toLowerCase();
  const password = (isReset ? c : b) ?? "";
  const name = (isReset ? "" : (c ?? "")).trim();

  // 이메일 검사는 아이디 변경(--email)과 **같은 함수**를 쓴다(기준이 갈리지 않게).
  checkEmailOrExit(email);
  if (password.length < PASSWORD_MIN_LEN) {
    console.error(`✖ 비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.`);
    process.exit(1);
  }
  if (password.length > PASSWORD_MAX_LEN) {
    console.error(`✖ 비밀번호는 ${PASSWORD_MAX_LEN}자 이하여야 합니다(앱 로그인이 그 길이에서 막습니다).`);
    process.exit(1);
  }
  // 🔴 흔한 비밀번호·뻔한 패턴 차단 — 고객사와 같은 규칙(검수 M-3 후속 중간 2).
  //    ⚠️ 반드시 위 길이 상한 검사 **뒤**에 둔다(거대 입력에 CPU를 태우지 않기 위함).
  //    이름은 힌트로 넘긴다(이메일은 아이디가 짧아 오탐을 만들 수 있어 넘기지 않는다).
  {
    const weak = checkPasswordStrength(password, { name });
    if (weak) {
      console.error("✖ " + weak);
      process.exit(1);
    }
  }

  const existing = await prisma.operator.findUnique({ where: { email } });

  // 실수 방어 — "만들기"로 기존 계정을 덮어쓰거나, "--reset"으로 없는 계정을 고치려는 경우.
  if (existing && !isReset) {
    console.error(`✖ 이미 있는 계정입니다: ${email}`);
    console.error(`  비밀번호를 바꾸려면 --reset 을 붙여주세요:`);
    console.error(`    node scripts/create-operator.mjs --reset "${email}" "새 비밀번호"`);
    console.error(`  (잠금만 풀려면  --unlock "${email}" )`);
    process.exit(1);
  }
  if (!existing && isReset) {
    console.error(`✖ 그런 운영자 계정이 없습니다: ${email} (새로 만들려면 --reset 없이 이름까지 적어주세요)`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    // 비밀번호 교체 + 세션 정리 + 기록을 **한 묶음**으로 한다(아이디 변경 --email 과 같은 규칙).
    //  그래야 "비밀번호는 바뀌었는데 기록은 없는" 중간 상태가 생기지 않는다.
    //
    //  🔴 기록을 남기는 이유(2026-11-20 사장님 지시): 이날 "비밀번호를 바꿨는데 로그인이 안 된다"를
    //     조사하면서, 변경이 실제로 일어났는지 **아무도 확인할 수 없다**는 것이 드러났다.
    //     아이디 변경은 기록을 남기는데 비밀번호 변경만 빠져 있었다.
    //  🔴 비밀번호 자체는 절대 남기지 않는다 — 언제·누가·어느 계정인지만 남긴다.
    //  🔴 companyId·userId 는 **반드시 null** — 그래야 고객사 화면으로 새지 않는다
    //     (app/actions/operator.ts 의 logOperator 와 같은 규칙).
    //  🔴 meta 값을 새로 만들면 **lib/access-labels.ts 에도 반드시 같이 넣는다.** 빠뜨리면
    //     [운영자 접속 기록] 화면과 엑셀에서 "무슨 일인지"가 빈칸으로 나온다(2026-11-20 검수 치명 2).
    //
    //  🔴 열려 있던 로그인을 전부 끊는 이유: 안 끊으면 예전 비밀번호를 아는 사람이 이미 열어 둔
    //     창으로 계속 들어와 있을 수 있다(비밀번호 변경의 목적이 사라진다).
    const [, gone] = await prisma.$transaction([
      prisma.operator.update({
        where: { email },
        data: {
          passwordHash,
          // 비밀번호를 새로 정했으니 실패 횟수·잠금을 함께 푼다(잠겨서 못 들어오는 상태를 이 명령으로 구제).
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      prisma.operatorSession.deleteMany({ where: { operatorId: existing.id } }),
      prisma.accessEvent.create({
        data: {
          companyId: null,
          userId: null,
          actorName: `운영자 ${existing.name}`,
          emailTried: email,
          kind: "config",
          result: "success",
          ip: null,
          userAgent: null,
          device: "서버 명령",
          meta: "operator_password_reset",
        },
      }),
    ]);
    console.log(`✔ 비밀번호를 새로 정했습니다: ${email} (열려 있던 로그인 ${gone.count}건 해제)`);
    // 🔴 꺼진 계정은 **되살리지 않는다**(검수 M-2). 끄기는 "이 사람은 이제 못 들어온다"는 의사표시라,
    //    비밀번호를 바꿨다는 이유로 조용히 되살리면 그 의사표시가 뒤집힌다.
    //    대신 크게 알려 준다 — 안 알려주면 "성공했다는데 로그인이 안 된다"가 되어, 재설정 창구가
    //    없는 이 계정에서 몇 번 더 시도하다 5회 잠금까지 걸린다.
    if (!existing.active) {
      console.log("  ⚠ 이 계정은 지금 **꺼져 있어 로그인되지 않습니다.** 쓰려면 이어서:");
      console.log(`      node scripts/create-operator.mjs --on "${email}"`);
    }
  } else {
    if (!name) {
      console.error("✖ 새 계정은 이름도 함께 적어주세요. 예: node scripts/create-operator.mjs \"me@example.com\" \"비밀번호\" \"홍길동\"");
      process.exit(1);
    }
    await prisma.operator.create({ data: { email, passwordHash, name } });
    console.log(`✔ 운영자 계정을 만들었습니다: ${email} (${name})`);
  }
  // ⚠️ 주소를 박아 넣지 않는다(검수 E-5) — 실제 서버에서 실행하면 localhost는 틀린 안내가 된다.
  console.log(`  → 로그인 주소: ${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/operator/login`);
}

main()
  .catch((e) => {
    console.error("✖ 실패:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
