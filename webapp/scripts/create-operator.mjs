// 운영자(본사) 계정 만들기 / 비밀번호 바꾸기 — **서버에서 직접 실행하는 명령**이다.
//
// 사용법 (webapp 폴더에서):
//   node scripts/create-operator.mjs "이메일" "비밀번호" "이름"
//   node scripts/create-operator.mjs --list                 ← 지금 있는 운영자 계정 보기
//   node scripts/create-operator.mjs --off "이메일"          ← 계정 끄기(지우지 않는다)
//   node scripts/create-operator.mjs --on  "이메일"          ← 다시 켜기
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
import { hashPassword } from "../lib/password.ts";
// 길이·잠금 정책 상수도 앱과 같은 곳에서 가져온다(여기 숫자를 다시 적으면 정책이 갈린다).
import { EMAIL_MAX_LEN, PASSWORD_MAX_LEN } from "../lib/login-policy.ts";

// 가입 화면과 같은 최소 길이(app/actions/auth.ts signup).
const PASSWORD_MIN_LEN = 8;

const prisma = new PrismaClient();

// ⚠️ 이 파일은 `.mjs`라 **타입 표기를 쓸 수 없다**(Node가 .mjs는 타입을 걷어내지 않는다 —
//    실제로 `function usage(): never`라고 썼다가 문법 오류가 났다). 불러오는 `../lib/*.ts` 쪽은
//    Node 24가 타입을 걷어내므로 그대로 동작한다. 확장자를 `.mts`로 바꾸면 이 파일도 타입을 쓸 수
//    있지만, 그러면 `npx tsc --noEmit`이 `.ts` 확장자 import를 오류로 잡는다(tsconfig include에 .mts가 있다).
//    → 기존 scripts/*.mjs 관례에 맞춘다.
function usage() {
  console.log(`
운영자 계정 관리

  node scripts/create-operator.mjs "이메일" "비밀번호" "이름"   계정 만들기(있으면 비밀번호·이름 변경)
  node scripts/create-operator.mjs --list                      계정 목록 보기
  node scripts/create-operator.mjs --off "이메일"               계정 끄기
  node scripts/create-operator.mjs --on  "이메일"               계정 켜기
`);
  process.exit(1);
}

async function main() {
  const [a, b, c] = process.argv.slice(2);
  if (!a) usage();

  // ── 목록 보기 ──
  if (a === "--list") {
    const rows = await prisma.operator.findMany({ orderBy: { createdAt: "asc" } });
    if (rows.length === 0) {
      console.log("운영자 계정이 아직 없습니다.");
      return;
    }
    console.log(`운영자 계정 ${rows.length}개`);
    for (const r of rows) {
      const state = r.active ? "사용중" : "중지";
      const last = r.lastLoginAt ? r.lastLoginAt.toLocaleString("ko-KR") : "로그인 이력 없음";
      console.log(`  · ${r.email}  (${r.name})  [${state}]  마지막 로그인: ${last}`);
    }
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

  // ── 만들기 / 비밀번호 변경 ──
  const email = a.trim().toLowerCase();
  const password = b ?? "";
  const name = (c ?? "").trim();

  if (!email.includes("@") || email.length < 5) {
    console.error("✖ 이메일 형식이 올바르지 않습니다.");
    process.exit(1);
  }
  // 🔴 앱의 로그인이 이 길이를 넘으면 **비밀번호를 보기도 전에 거부**한다.
  //    여기서 막지 않으면 그 순간 "로그인할 수 없는 운영자 계정"이 만들어진다
  //    (재설정 창구가 없으므로 되돌릴 방법도 없다 — 고객사 쪽 검수 치명 1과 같은 함정).
  if (email.length > EMAIL_MAX_LEN) {
    console.error(`✖ 이메일은 ${EMAIL_MAX_LEN}자 이하여야 합니다.`);
    process.exit(1);
  }
  if (password.length < PASSWORD_MIN_LEN) {
    console.error(`✖ 비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.`);
    process.exit(1);
  }
  if (password.length > PASSWORD_MAX_LEN) {
    console.error(`✖ 비밀번호는 ${PASSWORD_MAX_LEN}자 이하여야 합니다(앱 로그인이 그 길이에서 막습니다).`);
    process.exit(1);
  }

  const existing = await prisma.operator.findUnique({ where: { email } });
  const passwordHash = hashPassword(password);

  if (existing) {
    await prisma.operator.update({
      where: { email },
      data: {
        passwordHash,
        ...(name ? { name } : {}),
        // 비밀번호를 새로 정했으니 실패 횟수·잠금을 함께 푼다(잠겨서 못 들어오는 상태를 이 명령으로 구제).
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // 🔴 비밀번호를 바꿨으면 **열려 있던 로그인을 전부 끊는다.** 안 끊으면 예전 비밀번호를 아는
    //    사람이 이미 열어 둔 창으로 계속 들어와 있을 수 있다(비밀번호 변경의 목적이 사라진다).
    const gone = await prisma.operatorSession.deleteMany({ where: { operatorId: existing.id } });
    console.log(`✔ 비밀번호를 새로 정했습니다: ${email} (열려 있던 로그인 ${gone.count}건 해제)`);
  } else {
    if (!name) {
      console.error("✖ 새 계정은 이름도 함께 적어주세요. 예: node scripts/create-operator.mjs \"me@example.com\" \"비밀번호\" \"홍길동\"");
      process.exit(1);
    }
    await prisma.operator.create({ data: { email, passwordHash, name } });
    console.log(`✔ 운영자 계정을 만들었습니다: ${email} (${name})`);
  }
  console.log("  → 로그인 주소: http://localhost:3000/operator/login");
}

main()
  .catch((e) => {
    console.error("✖ 실패:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
