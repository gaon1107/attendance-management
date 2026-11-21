// 고객사 사용 안내서에 넣을 **화면 캡처**를 자동으로 찍는 스크립트. (2026-11-20 사장님 승인)
//
// 왜 스크립트로 남기나: 안내서는 화면이 바뀔 때마다 다시 찍어야 한다. 손으로 찍으면
//   ① 크기·배율이 매번 달라져 문서가 들쭉날쭉해지고 ② 어느 화면을 어떤 상태에서 찍었는지 잊는다.
//   이 파일이 "안내서 그림의 원본 절차"다.
//
// 쓰는 법 (webapp 폴더에서, 개발 서버 3000이 떠 있어야 한다):
//   node scripts/make-guide-shots.mjs "<데모 계정 비밀번호>" [출력폴더]
//   · 비밀번호 = scripts/seed-demo.mjs 로 데모 회사를 만들 때 쓴 그 값(10명 전원 공통).
//   · 출력폴더 생략 시 ./guide-shots
//
// 🔴 반드시 지킨 것
//  ① **데모 회사만 쓴다.** 로그인 계정은 seed-demo.mjs 가 만든 `@hanbit.example` 뿐이다.
//     실고객 계정으로 돌리면 남의 회사 직원 실명이 안내서에 박힌다.
//  ② **비밀번호를 파일에 적지 않는다**(사규 8). 실행할 때 인자로 받는다.
//  ③ **읽기만 한다 — 딱 하나 예외**: [초대 링크 만들기] 버튼을 눌러 초대를 1건 만든다
//     (초대 화면을 찍으려면 실제 토큰이 필요하다). 데모 회사 안에서만 생기고 7일 뒤 만료된다.
//  ④ **화면을 고치지 않는다.** app/ 아래 코드는 건드리지 않는다.
//
// ⚠️ 얼굴 등록 화면은 **가짜 카메라**(크로미움 테스트 패턴)로 찍힌다. 실제 사람 얼굴이 아니다.
//    안내서에서는 "카메라가 켜진 자리"를 보여주는 용도로만 쓰고, 설명으로 보완한다.
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// playwright 는 이 프로젝트의 의존성이 아니라 **전역 설치**를 쓴다(화면 캡처 전용이라
//  webapp 배포물에 넣을 이유가 없다). 경로를 소스에 박아 두면 PC·계정이 바뀌는 순간
//  안내서 재생성이 통째로 멈추고, 사용자 폴더 이름이 깃에 올라간다 → 매번 찾아서 쓴다.
async function loadChromium() {
  try {
    return (await import("playwright")).chromium; // 나중에 npm i -D playwright 를 해도 그대로 동작
  } catch { /* 전역에서 찾는다 */ }
  const roots = [
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "playwright", "index.mjs"),
    process.env.npm_config_prefix && path.join(process.env.npm_config_prefix, "node_modules", "playwright", "index.mjs"),
    "/usr/local/lib/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const p of roots) {
    if (fs.existsSync(p)) return (await import(pathToFileURL(p).href)).chromium;
  }
  console.error("✖ playwright 를 찾지 못했습니다. 먼저 아래 두 줄을 실행해 주세요:");
  console.error("    npm i -g playwright");
  console.error("    npx playwright install chromium");
  process.exit(1);
}

const BASE = "http://localhost:3000";
// 🔒 비밀번호는 환경변수를 **먼저** 본다. 인자로 주면 PowerShell 기록·작업관리자 명령줄에 평문으로 남는다.
//    (환경변수로 주는 법:  $env:DEMO_PW = "..." ; node scripts/make-guide-shots.mjs "" 출력폴더)
const PW = process.env.DEMO_PW || process.argv[2];
const OUT_DIR = path.resolve(process.argv[3] || "guide-shots");

if (!PW) {
  console.error("사용법: node scripts/make-guide-shots.mjs \"<데모 계정 비밀번호>\" [출력폴더]");
  console.error("  또는: $env:DEMO_PW = \"<비밀번호>\" 로 미리 넣어 두고 비밀번호 자리를 \"\" 로 둔다(기록에 안 남음).");
  console.error("  ※ 인자로 주셨다면 끝나고 PowerShell 에서 Clear-History 를 한 번 실행해 주세요.");
  process.exit(1);
}

// 데모 회사(주식회사 한빛솔루션) 계정 — seed-demo.mjs 의 EMAIL_ID 와 짝이 맞아야 한다.
const ADMIN = "seojun.kim@hanbit.example"; // 김서준 · 관리자 · 경영지원팀 팀장
const EMP_GPS = "sumin.lee@hanbit.example"; // 이수민 · 직원 · GPS 인증
const EMP_FACE = "jihoon.oh@hanbit.example"; // 오지훈 · 직원 · 얼굴 인증
const EMP_GPS2 = "soyoung.han@hanbit.example"; // 한소영 · 직원 · GPS (출근 전 상태 확보용)

// 사무실 좌표(seed-demo.mjs 와 동일) — GPS 출퇴근 화면이 "사무실 범위 안"으로 나오게.
const OFFICE = { latitude: 37.500622, longitude: 127.036456 };

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// 🔴 지난번 PNG 를 반드시 지우고 시작한다.
//    안 지우면 이번에 **못 찍은 화면이 지난번 그림으로 다시 구워져**, 바뀐 화면을 설명하는
//    안내서에 옛 그림이 실린 채로 "완료"가 뜬다. 조용히 틀리는 쪽이 제일 위험하다.
fs.mkdirSync(OUT_DIR, { recursive: true });
const raw = path.join(OUT_DIR, "_raw");
fs.rmSync(raw, { recursive: true, force: true });
fs.mkdirSync(raw, { recursive: true });

// 찍혀야 하는 그림의 **전체 목록**. 맨 끝에서 이 목록과 대조해 하나라도 빠지면 실패로 끝낸다.
const EXPECTED = [
  "pc-01-홈화면", "pc-02-회원가입", "pc-03-로그인", "pc-04-초기설정",
  "pc-10-대시보드", "pc-11-직원관리", "pc-12-직원추가-초대링크", "pc-13-부서직급",
  "pc-20-근태현황", "pc-21-현황판", "pc-22-리포트", "pc-23-초과근무현황", "pc-24-직원근태상세",
  "pc-30-휴가승인", "pc-31-정정승인",
  "pc-40-설정", "pc-40b-설정-근무규칙", "pc-41-회사정보", "pc-42-구독요금", "pc-43-생체정보", "pc-44-일정",
  // 2026-11-21 사장님 지시로 추가 — 안내서에 장이 없던 화면들.
  "pc-50-공지", "pc-51-알림", "pc-52-연차정산", "pc-53-휴게시간",
  "pc-54-PC관리", "pc-55-보안로그", "pc-56-계정",
  // 켠 회사에만 보이는 메뉴 — 데모 설정을 잠깐 켜고 찍는다(아래 7번).
  "pc-57-근무표", "pc-58-결재함",
  "m-01-초대가입", "m-02-로그인", "m-03-메뉴",
  "m-10-출퇴근", "m-10b-출퇴근-다른상태", "m-11-인증방식",
  "m-20-내근태", "m-21-휴가신청", "m-22-정정신청", "m-23-외출외근", "m-24-초과근무",
  "m-30-생체정보동의", "m-31-얼굴등록", "m-31b-얼굴등록-카메라", "m-32-얼굴출퇴근",
];
const taken = new Set();
const skipped = [];
/** 못 찍고 넘어간 것을 **반드시 말한다**. 조용히 넘어가면 빠진 줄 아무도 모른다. */
function skip(name, why) {
  skipped.push(`${name} — ${why}`);
  console.warn(`  ⚠ 건너뜀: ${name} (${why})`);
}

/** 화면이 조용해질 때까지 기다린다. 애니메이션·지도 타일 때문에 넉넉히 준다. */
async function settle(page, ms = 900) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await hideDevBadge(page);
  await page.waitForTimeout(ms);
}

/** 🔴 Next.js 개발용 배지(오른쪽 아래 까만 동그라미 "N")를 숨긴다.
 *  개발 서버에서만 나오는 것이라 **실제 고객 화면에는 없다**. 안내서에 찍히면
 *  고객이 "이 버튼은 뭐냐"고 묻게 되는 가짜 UI다. 화면 코드는 건드리지 않고
 *  캡처할 때만 CSS로 가린다(next.config.ts 를 고치면 사장님 서버 동작이 바뀐다). */
async function hideDevBadge(page) {
  await page
    .addStyleTag({
      content:
        "nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button],#__next-build-watcher{display:none !important;}",
    })
    .catch(() => {});
}

/** 🔴 화면에 박힌 개발 PC 주소(http://localhost:3000)를 **고객이 쓸 주소**로 바꾼다.
 *  [PC관리]·[계정]의 PC-OFF 설치 안내가 그 주소를 그대로 보여 준다(화면 코드가 자기 주소를 읽어 적는다).
 *  그대로 찍으면 고객 안내서에 **"http://localhost:3000 에서 내려받으세요"** 가 박힌다 —
 *  고객 PC에서는 절대 열리지 않는 주소이고, 문의를 부르는 가짜 안내가 된다.
 *  ※ 초대 링크(pc-12)와 같은 이유의 처리다. 거기는 토큰까지 가려야 해 따로 둔다.
 *  ⚠️ **보이는 글자만** 바꾼다. 실제 이동·클릭은 하지 않으므로 화면 동작에는 영향이 없다. */
async function maskLocalhost(page) {
  await page
    .evaluate(() => {
      const fix = (t) =>
        t.split("http://localhost:3000").join("https://attend.newgaon.com")
         .split("localhost:3000").join("attend.newgaon.com");
      for (const el of document.querySelectorAll("input,textarea")) {
        if (typeof el.value === "string" && el.value.includes("localhost:3000")) el.value = fix(el.value);
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const n of nodes) {
        if (n.nodeValue && n.nodeValue.includes("localhost:3000")) n.nodeValue = fix(n.nodeValue);
      }
      for (const a of document.querySelectorAll('a[href*="localhost:3000"]')) {
        a.setAttribute("href", fix(a.getAttribute("href")));
      }
    })
    .catch(() => {});
}

/** 접이식(<details>) 묶음을 전부 펼친다 — 접힌 채로는 설명할 내용이 안 보인다. */
async function openDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
}

/** 화면의 특정 부분으로 스크롤한다(그 부분이 화면 가운데 오게). */
async function scrollTo(page, text) {
  const el = page.getByText(text, { exact: false }).first();
  if (!(await el.count())) {
    // 글자가 바뀌었는데 모르고 지나가면 **엉뚱한 자리**가 찍힌다 → 알린다.
    console.warn(`  ⚠ 화면에서 "${text}" 를 찾지 못해 스크롤하지 않았습니다(그림이 엉뚱할 수 있음).`);
    return;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(() => window.scrollBy(0, -120)); // 제목이 맨 위에 딱 붙지 않게
  await page.waitForTimeout(500);
}

async function shot(page, name, { full = false } = {}) {
  // 🔴 **찍기 직전에만** 개발 PC 주소를 가린다.
  //    settle() 에 두면 화면 값을 읽어 쓰는 코드(초대 링크 확보)보다 먼저 돌아,
  //    가짜 주소를 읽어 그리로 이동하다 m-01-초대가입 캡처가 실패한다(실제로 그럴 뻔했다).
  await maskLocalhost(page);
  const file = path.join(raw, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  const { width, height } = await sharp(file).metadata();
  taken.add(name);
  console.log(`  · ${name}.png  ${width}×${height}`);
  return file;
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await settle(page);
}

// ══════════════════════════════════════════════════════════════════════
// 개발 서버가 떠 있는지 먼저 본다. 안 보면 30초 뒤에 영어 오류만 나와서 원인을 알 수 없다.
try {
  const res = await fetch(BASE, { method: "GET" });
  if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`✖ 개발 서버(${BASE})에 연결하지 못했습니다. 먼저 서버를 켜 주세요.`);
  console.error(`  (바탕화면의 근태관리_실행.bat 를 더블클릭하거나, webapp 에서 npm run dev)`);
  console.error("  원인:", e?.message);
  process.exit(1);
}

// 🔒 데모 데이터를 건드리기 전에 **지금 보고 있는 DB가 개발 DB가 맞는지** 확인한다.
//    스크립트의 DB 연결과 dev 서버의 DB 연결은 별개라, 실수로 다른 DB를 가리키면
//    "A DB 의 사람을 바꾸고 B DB 의 화면을 찍는" 조용한 사고가 난다.
const prisma = new PrismaClient();
const dbUrl = process.env.DATABASE_URL || "";
if (dbUrl && !/dev\.db/i.test(dbUrl)) {
  console.error(`✖ 개발 DB(dev.db)가 아닙니다: ${dbUrl}`);
  console.error("  이 스크립트는 개발 DB 전용입니다. 운영·검증 DB에서는 돌리지 않습니다.");
  await prisma.$disconnect();
  process.exit(1);
}
const demoCompany = await prisma.company.findFirst({
  where: { name: "주식회사 한빛솔루션", isDemo: true },
  select: { id: true },
});
if (!demoCompany) {
  console.error("✖ 데모 회사(주식회사 한빛솔루션)가 없습니다. 먼저 만들어 주세요:");
  console.error('    node scripts/seed-demo.mjs "<비밀번호>"');
  await prisma.$disconnect();
  process.exit(1);
}
// 지난 실행에서 만든 초대가 남아 있으면 캡처에 2줄·3줄로 쌓여 그림이 지저분해진다. 먼저 비운다.
{
  const r = await prisma.invite.deleteMany({ where: { companyId: demoCompany.id } });
  if (r.count) console.log(`· 지난 초대 ${r.count}건을 정리했습니다(캡처에 여러 줄로 쌓이지 않게).`);
}

const chromium = await loadChromium();
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream", // 카메라 허용 창을 자동 통과
    "--use-fake-device-for-media-stream", // 가짜 카메라(테스트 패턴)
    "--force-color-profile=srgb",
  ],
});

const common = {
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
  deviceScaleFactor: 2, // 2배로 찍어 두고 나중에 줄인다(글씨가 또렷해진다)
  colorScheme: "light",
  geolocation: OFFICE,
  permissions: ["geolocation", "camera"],
};

try {
  // ── 1. 로그인 전 공개 화면 ────────────────────────────────────────
  console.log("\n[1/4] 로그인 전 화면");
  {
    const ctx = await browser.newContext({ ...common, viewport: DESK });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await settle(page, 1400);
    await shot(page, "pc-01-홈화면");

    await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await shot(page, "pc-02-회원가입", { full: true });

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await shot(page, "pc-03-로그인");

    await ctx.close();
  }

  // ── 2. 관리자 PC 화면 ─────────────────────────────────────────────
  console.log("\n[2/4] 관리자 PC 화면");
  let inviteUrl = null;
  {
    const ctx = await browser.newContext({ ...common, viewport: DESK });
    const page = await ctx.newPage();
    await login(page, ADMIN);

    // 🔴 관리자 PC 화면은 **보이는 만큼만**(fullPage 금지) 찍는다.
    //    사이드바가 sticky 라서 페이지 전체를 찍으면 사이드바가 문서 한가운데에 둥둥 떠 보인다
    //    (2026-11-20 실제로 그렇게 찍혔다). 아래쪽을 보여줄 때는 scroll 로 그 자리까지 내려가 찍는다.
    const pages = [
      ["pc-10-대시보드", "/dashboard", null],
      ["pc-11-직원관리", "/employees", null],
      ["pc-20-근태현황", "/records", null],
      ["pc-21-현황판", "/live", null],
      ["pc-22-리포트", "/reports", null],
      ["pc-23-초과근무현황", "/overtime-manage", null],
      ["pc-30-휴가승인", "/leave/approvals", null],
      ["pc-31-정정승인", "/corrections/approvals", null],
      ["pc-40-설정", "/settings", null],
      ["pc-40b-설정-근무규칙", "/settings", "근무 규칙"],
      ["pc-41-회사정보", "/company", null],
      ["pc-42-구독요금", "/subscription", null],
      ["pc-43-생체정보", "/biometrics", null],
      ["pc-44-일정", "/schedule", null],
      // ── 안내서에 장이 없던 화면들 (2026-11-21) ──
      //  ⚠️ [보안로그]의 주소는 /security 가 아니라 **/security/logins** 다(사이드바 HREF 와 같은 진입점).
      //     /security 로 가면 탭이 없는 빈 화면이 찍힌다.
      ["pc-50-공지", "/notice", null],
      ["pc-51-알림", "/notifications", null],
      ["pc-52-연차정산", "/leave-summary", null],
      ["pc-53-휴게시간", "/break-time", null],
      ["pc-54-PC관리", "/pc-devices", null],
      ["pc-55-보안로그", "/security/logins", null],
      ["pc-56-계정", "/account", null],
    ];
    for (const [name, url, scroll] of pages) {
      await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
      await settle(page, url === "/live" ? 2200 : 900); // 지도 타일은 더 기다린다
      await openDetails(page);
      await settle(page, 250);
      if (scroll) await scrollTo(page, scroll);
      await shot(page, name);
    }

    // 가입 직후 초기설정 화면 — 사이드바가 없는 집중형 화면이라 전체를 찍어도 안전하다.
    await page.goto(`${BASE}/onboarding`, { waitUntil: "domcontentloaded" });
    await settle(page, 1600);
    await shot(page, "pc-04-초기설정", { full: true });

    // 직원 한 명 상세(근태 기록) — 목록 첫 줄을 눌러 들어간다.
    await page.goto(`${BASE}/records`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const detail = page.locator('a[href^="/records/"]').first();
    if (await detail.count()) {
      await detail.click();
      await settle(page, 1200);
      await shot(page, "pc-24-직원근태상세");
    } else {
      skip("pc-24-직원근태상세", "근태 현황 표에 눌러 들어갈 직원 줄이 없습니다");
    }

    // 초대 링크 만들기 → 실제 토큰 확보(초대 화면 캡처에 필요)
    await page.goto(`${BASE}/employees`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await openDetails(page);
    await page.getByRole("button", { name: /초대 링크 만들기/ }).click();
    await settle(page, 1200);
    await openDetails(page);
    await settle(page, 300);
    const box = page.locator('input[readonly]').first();
    if (await box.count()) inviteUrl = await box.inputValue();
    if (!inviteUrl) skip("pc-12 초대 링크", "초대 링크 칸을 찾지 못했습니다");
    console.log(`  · 초대 링크 확보: ${inviteUrl ? "성공" : "실패"}`);

    // 🔴 화면에 보이는 주소만 바꿔 찍는다. 두 가지를 동시에 막는다.
    //  ① 개발 PC에서 찍으면 `http://localhost:3000/...` 이 박힌다 → 고객이 눌러도 안 열리는 주소를 안내하는 꼴.
    //  ② **진짜 초대 토큰**이 고객 배포 문서에 선명하게 박힌다. 지금은 주소가 달라 쓸 수 없지만,
    //     토큰은 "7일간 그 회사에 가입할 수 있는 열쇠"다. 그림에는 가짜 토큰만 남긴다.
    //  ※ 실제 이동은 위에서 읽어 둔 inviteUrl(진짜 주소)로 한다 — 보이는 글자만 바꾼다.
    await page.evaluate(() => {
      const el = document.querySelector("input[readonly]");
      if (el) el.value = "https://attend.newgaon.com/invite/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    });
    await scrollTo(page, "직원 초대");
    await shot(page, "pc-12-직원추가-초대링크");

    // 부서·직급 만들기(처음 한 번 하는 일)
    await scrollTo(page, "부서·결재선 관리");
    await shot(page, "pc-13-부서직급");

    await ctx.close();
  }

  // ── 3. 직원 폰 화면 ──────────────────────────────────────────────
  console.log("\n[3/4] 직원 폰 화면");
  {
    const ctx = await browser.newContext({
      ...common,
      viewport: PHONE,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await ctx.newPage();

    // 초대 링크로 가입하는 화면(로그인 전) — 직원이 가장 먼저 보는 화면이다.
    if (inviteUrl) {
      await page.goto(inviteUrl, { waitUntil: "domcontentloaded" });
      await settle(page);
      await shot(page, "m-01-초대가입", { full: true });
    } else {
      skip("m-01-초대가입", "앞 단계에서 초대 링크를 얻지 못했습니다");
    }

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await shot(page, "m-02-로그인");

    await login(page, EMP_GPS);

    const empPages = [
      ["m-10-출퇴근", "/attendance", { full: true }],
      ["m-11-인증방식", "/auth-method", { full: true }],
      ["m-20-내근태", "/my-records", { full: true }],
      ["m-21-휴가신청", "/leave", { full: true }],
      ["m-22-정정신청", "/corrections", { full: true }],
      ["m-23-외출외근", "/outing", { full: true }],
      ["m-24-초과근무", "/overtime", { full: true }],
    ];
    for (const [name, url, opt] of empPages) {
      await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
      await settle(page, 1100);
      await openDetails(page);
      await settle(page, 250);
      await shot(page, name, opt);
    }

    // 폰 메뉴(서랍) 열린 모습
    await page.goto(`${BASE}/attendance`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const menu = page.getByRole("button", { name: /메뉴/ }).first();
    if (await menu.count()) {
      await menu.click().catch(() => {});
      await settle(page, 700);
      await shot(page, "m-03-메뉴");
    } else {
      skip("m-03-메뉴", "폰 화면에서 메뉴(☰) 버튼을 찾지 못했습니다");
    }

    await ctx.close();
  }

  // ── 4. 얼굴 인증 직원(동의·등록 화면) ────────────────────────────
  console.log("\n[4/4] 얼굴 인증 화면");
  {
    const ctx = await browser.newContext({
      ...common,
      viewport: PHONE,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await login(page, EMP_FACE);

    for (const [name, url] of [
      ["m-30-생체정보동의", "/consent"],
      ["m-31-얼굴등록", "/face-enroll"],
      ["m-32-얼굴출퇴근", "/attendance"],
    ]) {
      await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
      await settle(page, 2000); // 카메라가 켜질 시간
      await shot(page, name, { full: true });
    }
    await ctx.close();
  }

  // ── 5. 출근 전 상태(한소영) ──────────────────────────────────────
  {
    const ctx = await browser.newContext({ ...common, viewport: PHONE, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await login(page, EMP_GPS2);
    await page.goto(`${BASE}/attendance`, { waitUntil: "domcontentloaded" });
    await settle(page, 1200);
    await shot(page, "m-10b-출퇴근-다른상태", { full: true });
    await ctx.close();
  }

  // ── 6. 얼굴 "등록 중"(카메라 켜진) 화면 ──────────────────────────
  //  위 4번의 오지훈은 이미 3/3 등록이 끝난 상태라 **완료 화면**만 찍힌다.
  //  고객사 직원이 실제로 보게 될 "카메라가 켜진 등록 화면"을 찍으려면 아직 등록 전인 사람이 필요하다.
  //  → 데모 회사의 한소영(원래 GPS)을 **잠깐** 얼굴인증 + 동의함 + 미등록으로 바꿔 찍고 **반드시 되돌린다.**
  //  🔴 데모 회사(@hanbit.example) 계정 하나만 건드린다. 원복은 finally 로 보장한다.
  //
  //  🔴 **[촬영하기] 를 누르는 코드를 절대 추가하지 말 것.**
  //     누르면 얼굴서버(GaonFR)에 가짜 얼굴이 **실제로 등록**되는데, 여기서는 DB만 되돌리므로
  //     `faceEnrolledAt`이 null 로 돌아가 화면의 [등록한 얼굴 삭제] 버튼이 사라진다
  //     (그 버튼은 등록 횟수 > 0 일 때만 보인다) → **지울 방법이 없는 생체정보**가 서버에 남는다.
  //     정상 경로(app/actions/authmethod.ts)만이 얼굴서버까지 함께 지운다.
  {
    // 되돌릴 값은 **고정 상수**다. "바꾸기 직전의 DB 값"을 되돌림 기준으로 쓰면,
    // 한 번이라도 원복에 실패해 망가진 값이 남았을 때 다음 실행이 그 값을 "원래대로"라며
    // 다시 써 넣어 **오염이 영구히 굳는다**(검수 치명 1).
    const RESTORE = { authMethod: "gps", faceConsentAt: null, faceEnrolledAt: null, faceEnrollCount: 0 };
    const before = await prisma.user.findFirst({
      where: { email: EMP_GPS2, companyId: demoCompany.id }, // 🔒 데모 회사 소속만
      select: { id: true, name: true, authMethod: true, faceConsentAt: true, faceEnrolledAt: true, faceEnrollCount: true },
    });

    const dirty =
      !before ||
      before.authMethod !== RESTORE.authMethod ||
      before.faceConsentAt !== null ||
      before.faceEnrolledAt !== null ||
      before.faceEnrollCount !== 0;

    if (!before) {
      skip("m-31b-얼굴등록-카메라", `데모 직원(${EMP_GPS2})을 찾지 못했습니다`);
    } else if (dirty) {
      // 평소 상태가 아니면 **건드리지 않는다**. 지난번 원복이 실패했다는 뜻이다.
      console.error(`  ✖ ${before.name} 계정이 평소 상태가 아닙니다 — 이번 캡처를 건너뜁니다.`);
      console.error(`    지금 값: ${JSON.stringify(before)}`);
      console.error(`    손으로 되돌릴 값: ${JSON.stringify(RESTORE)}`);
      skip("m-31b-얼굴등록-카메라", "데모 직원 계정이 평소 상태가 아님");
    } else {
      // 실패했을 때 사람이 복구할 수 있게, 바꾸기 **전에** 원래 값을 화면에 남긴다.
      console.log(`  · ${before.name} 계정을 잠시 얼굴인증으로 바꿉니다. 원래 값: ${JSON.stringify(RESTORE)}`);

      let restored = false;
      const restore = async (label) => {
        if (restored) return;
        restored = true;
        try {
          await prisma.user.update({ where: { id: before.id }, data: RESTORE });
          console.log(`  · ${before.name} 계정을 원래대로 되돌렸습니다(GPS)${label ? ` [${label}]` : ""}.`);
        } catch (e) {
          // 🔴 여기서 실패하면 사람이 고쳐야 한다. 조용히 끝내지 않는다.
          console.error("  ✖✖ 되돌리기에 실패했습니다. 아래 값으로 직접 고쳐 주세요.");
          console.error(`      대상: ${EMP_GPS2} (id ${before.id})`);
          console.error(`      값  : ${JSON.stringify(RESTORE)}`);
          console.error("      원인:", e?.message);
          process.exitCode = 1;
        }
      };
      // Ctrl+C·창 닫기로 멈출 때도 되돌린다. Node 는 SIGINT 에서 finally 를 실행하지 않는다.
      const onSignal = async () => { await restore("강제 종료"); await prisma.$disconnect().catch(() => {}); process.exit(130); };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);

      try {
        await prisma.user.update({
          where: { id: before.id },
          data: { authMethod: "face", faceConsentAt: new Date(), faceEnrolledAt: null, faceEnrollCount: 0 },
        });
        const ctx = await browser.newContext({ ...common, viewport: PHONE, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await login(page, EMP_GPS2);
        await page.goto(`${BASE}/face-enroll`, { waitUntil: "domcontentloaded" });
        await settle(page, 2600); // 카메라가 켜지고 타원 가이드가 그려질 시간
        await shot(page, "m-31b-얼굴등록-카메라", { full: true });
        await ctx.close();
      } finally {
        await restore();
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
    }
  }

  // ── 7. 켠 회사에만 보이는 화면(근무표·결재함) ────────────────────
  //  데모 회사는 평소 **교대근무도 결재선도 쓰지 않는다**(제품 기본값). 그래서 두 메뉴는 사이드바에
  //  아예 없고, 주소로 직접 들어가도 "아직 설정되지 않았습니다" 안내문만 찍힌다.
  //  안내서에는 **그 기능을 켠 회사가 보게 될 모습**이 필요하므로 잠깐 켜고 찍은 뒤 **반드시 되돌린다.**
  //  🔴 되돌릴 값은 위 6번과 같은 이유로 **고정 상수**다(지난 실패가 "원래 값"으로 굳는 것을 막는다).
  //  🔴 데모 회사 하나만 건드린다. 켜는 동안 만든 조·결재단계도 함께 지운다.
  {
    const RESTORE = { shiftMode: null, scheduleType: null, approvalMode: "single", approvalStepCount: 1 };
    const before = await prisma.company.findUnique({
      where: { id: demoCompany.id },
      select: { shiftMode: true, scheduleType: true, approvalMode: true, approvalStepCount: true },
    });
    const existingShifts = await prisma.shift.count({ where: { companyId: demoCompany.id } });
    const existingSteps = await prisma.approvalStep.count({ where: { companyId: demoCompany.id } });

    const dirty =
      !before ||
      before.shiftMode !== null ||
      before.scheduleType !== null ||
      before.approvalMode !== "single" ||
      before.approvalStepCount !== 1 ||
      existingShifts > 0 ||
      existingSteps > 0;

    if (dirty) {
      // 평소 상태가 아니면 건드리지 않는다 — 지난번 원복이 실패했다는 뜻이다.
      console.error("  ✖ 데모 회사가 평소 설정이 아닙니다 — 근무표·결재함 캡처를 건너뜁니다.");
      console.error(`    지금 값: ${JSON.stringify(before)} · 조 ${existingShifts}개 · 결재단계 ${existingSteps}개`);
      console.error(`    손으로 되돌릴 값: ${JSON.stringify(RESTORE)} (조·결재단계는 삭제)`);
      skip("pc-57-근무표", "데모 회사 설정이 평소 상태가 아님");
      skip("pc-58-결재함", "데모 회사 설정이 평소 상태가 아님");
    } else {
      console.log(`  · 데모 회사에 교대근무·결재선을 잠시 켭니다. 원래 값: ${JSON.stringify(RESTORE)}`);
      const madeStepIds = [];
      let restored = false;
      const restore = async (label) => {
        if (restored) return;
        restored = true;
        try {
          if (madeStepIds.length) await prisma.approvalStep.deleteMany({ where: { id: { in: madeStepIds } } });
          await prisma.shift.deleteMany({ where: { companyId: demoCompany.id } });
          await prisma.company.update({ where: { id: demoCompany.id }, data: RESTORE });
          console.log(`  · 데모 회사 설정을 원래대로 되돌렸습니다${label ? ` [${label}]` : ""}.`);
        } catch (e) {
          console.error("  ✖✖ 되돌리기에 실패했습니다. 아래대로 직접 고쳐 주세요.");
          console.error(`      회사: 주식회사 한빛솔루션 (id ${demoCompany.id})`);
          console.error(`      값  : ${JSON.stringify(RESTORE)} · Shift 전체 삭제 · ApprovalStep ${JSON.stringify(madeStepIds)} 삭제`);
          console.error("      원인:", e?.message);
          process.exitCode = 1;
        }
      };
      const onSignal = async () => { await restore("강제 종료"); await prisma.$disconnect().catch(() => {}); process.exit(130); };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);

      try {
        // (1) 교대근무 2교대 + 조 정의 — 근무표 화면이 직원 10명 × 요일 표로 나오게.
        await prisma.company.update({
          where: { id: demoCompany.id },
          data: { shiftMode: 2, scheduleType: "fixed", approvalMode: "deptline", approvalStepCount: 1 },
        });
        await prisma.shift.create({ data: { companyId: demoCompany.id, order: 1, name: "주간조", startTime: "06:00", endTime: "14:00" } });
        await prisma.shift.create({ data: { companyId: demoCompany.id, order: 2, name: "야간조", startTime: "14:00", endTime: "22:00" } });

        // (2) 결재함에 보여줄 "내 차례" 만들기.
        //  결재선을 켜기 전에 올라온 신청에는 결재단계가 없어 결재함이 **빈 화면**으로 찍힌다
        //  ("결재할 항목이 없습니다" 한 줄) — 그러면 무엇을 하는 화면인지 안내서에서 보이지 않는다.
        //  그래서 이미 대기 중인 휴가 신청에 **관리자(김서준) 차례** 단계를 붙인다. 캡처 뒤 지운다.
        const admin = await prisma.user.findFirst({ where: { email: ADMIN, companyId: demoCompany.id }, select: { id: true } });
        const waiting = await prisma.leaveRequest.findMany({
          where: { companyId: demoCompany.id, status: "pending", userId: { not: admin?.id } },
          orderBy: { createdAt: "desc" },
          take: 2,
          select: { id: true },
        });
        if (admin && waiting.length) {
          for (const w of waiting) {
            const step = await prisma.approvalStep.create({
              data: { companyId: demoCompany.id, requestType: "leave", requestId: w.id, stepOrder: 1, approverUserId: admin.id, status: "pending" },
            });
            madeStepIds.push(step.id);
          }
          console.log(`  · 결재함에 보여줄 대기 결재 ${madeStepIds.length}건을 임시로 만들었습니다.`);
        } else {
          console.warn("  ⚠ 대기 중인 휴가 신청이 없어 결재함이 빈 화면으로 찍힙니다.");
        }

        const ctx = await browser.newContext({ ...common, viewport: DESK });
        const page = await ctx.newPage();
        await login(page, ADMIN);
        for (const [name, url] of [["pc-57-근무표", "/shifts"], ["pc-58-결재함", "/approvals"]]) {
          await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
          await settle(page, 1100);
          await openDetails(page);
          await settle(page, 250);
          await shot(page, name);
        }
        await ctx.close();
      } finally {
        await restore();
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
    }
  }
} finally {
  await browser.close();
  await prisma.$disconnect().catch(() => {});
}

// ══════════════════════════════════════════════════════════════════════
// 🔴 찍어야 할 그림이 전부 나왔는지 대조한다.
//    이게 없으면 몇 장이 빠져도 "✔ 완료"가 뜨고, 그 자리엔 지난번 그림이 그대로 실린다.
const missing = EXPECTED.filter((n) => !taken.has(n));
const extra = [...taken].filter((n) => !EXPECTED.includes(n));
if (extra.length) console.warn(`\n⚠ 목록에 없는 그림을 찍었습니다(EXPECTED 에 추가해 주세요): ${extra.join(", ")}`);
if (missing.length) {
  console.error(`\n✖ 찍지 못한 그림 ${missing.length}장:`);
  for (const n of missing) console.error(`   · ${n}`);
  if (skipped.length) {
    console.error("  건너뛴 이유:");
    for (const s of skipped) console.error(`   · ${s}`);
  }
  console.error("\n  이 상태로는 안내서를 만들지 마세요 — 빠진 자리에 옛 그림이 실립니다.");
  process.exitCode = 1;
}

// ══════════════════════════════════════════════════════════════════════
// 굽기 — 2배로 찍은 PNG를 webp 로 줄인다(안내서 파일 크기 때문).
//  · PC 화면: 폭 1440 (문서에서 약 900px로 보여주니 1.6배)
//  · 폰 화면: 폭 그대로 780 (문서에서 약 320px로 보여주니 2.4배)
console.log("\n[굽기] webp 변환");
let total = 0;
for (const f of fs.readdirSync(raw).filter((x) => x.endsWith(".png"))) {
  const src = path.join(raw, f);
  const meta = await sharp(src).metadata();
  const targetW = f.startsWith("pc-") ? 1440 : meta.width;
  const out = path.join(OUT_DIR, f.replace(/\.png$/, ".webp"));
  await sharp(src)
    .resize({ width: Math.min(targetW, meta.width), withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(out);
  const kb = Math.round(fs.statSync(out).size / 1024);
  total += kb;
  console.log(`  · ${path.basename(out)}  ${kb}KB`);
}
const okMark = process.exitCode ? "⚠ 일부 실패" : "✔ 완료";
console.log(`\n${okMark} — ${OUT_DIR}  (webp ${EXPECTED.length - missing.length}/${EXPECTED.length}장 · 합계 약 ${Math.round(total / 1024 * 10) / 10}MB)`);
console.log("  원본 PNG는 _raw 폴더에 남아 있습니다(다시 구울 때 사용).");
if (process.exitCode) console.log("  🔴 위 '찍지 못한 그림' 을 해결한 뒤 다시 돌려 주세요.");
