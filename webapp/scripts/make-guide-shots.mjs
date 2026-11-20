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
import { chromium } from "file:///C:/Users/%EC%A3%BC%EC%9D%B8%EB%8B%98/AppData/Roaming/npm/node_modules/playwright/index.mjs";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const PW = process.argv[2];
const OUT_DIR = path.resolve(process.argv[3] || "guide-shots");

if (!PW) {
  console.log("사용법: node scripts/make-guide-shots.mjs \"<데모 계정 비밀번호>\" [출력폴더]");
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

fs.mkdirSync(OUT_DIR, { recursive: true });
const raw = path.join(OUT_DIR, "_raw");
fs.mkdirSync(raw, { recursive: true });

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

/** 접이식(<details>) 묶음을 전부 펼친다 — 접힌 채로는 설명할 내용이 안 보인다. */
async function openDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
}

/** 화면의 특정 부분으로 스크롤한다(그 부분이 화면 가운데 오게). 없으면 조용히 넘어간다. */
async function scrollTo(page, text) {
  const el = page.getByText(text, { exact: false }).first();
  if (await el.count()) {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy(0, -120)); // 제목이 맨 위에 딱 붙지 않게
    await page.waitForTimeout(500);
  }
}

async function shot(page, name, { full = false } = {}) {
  const file = path.join(raw, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  const { width, height } = await sharp(file).metadata();
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
    console.log(`  · 초대 링크 확보: ${inviteUrl ? "성공" : "실패"}`);

    // 🔴 화면에 보이는 주소만 운영 주소로 바꿔 찍는다.
    //    개발 PC에서 찍으면 `http://localhost:3000/...` 이 박히는데, 고객사 안내서에 그 주소가 들어가면
    //    "여길 눌러 보세요" 하고 **열리지 않는 주소**를 안내하는 꼴이 된다.
    //    ※ 실제 이동은 위에서 읽어 둔 inviteUrl(localhost)로 한다 — 보이는 글자만 바꾼다.
    await page.evaluate(() => {
      const el = document.querySelector("input[readonly]");
      if (el) el.value = el.value.replace(/^https?:\/\/[^/]+/, "https://attend.newgaon.com");
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
  {
    const prisma = new PrismaClient();
    let before = null;
    try {
      before = await prisma.user.findFirst({
        where: { email: EMP_GPS2 },
        select: { id: true, authMethod: true, faceConsentAt: true, faceEnrolledAt: true, faceEnrollCount: true },
      });
      if (before) {
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
      }
    } finally {
      if (before) {
        await prisma.user.update({
          where: { id: before.id },
          data: {
            authMethod: before.authMethod,
            faceConsentAt: before.faceConsentAt,
            faceEnrolledAt: before.faceEnrolledAt,
            faceEnrollCount: before.faceEnrollCount,
          },
        });
        console.log("  · 한소영 계정을 원래대로 되돌렸습니다(GPS).");
      }
      await prisma.$disconnect();
    }
  }
} finally {
  await browser.close();
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
console.log(`\n✔ 완료 — ${OUT_DIR}  (webp 합계 약 ${Math.round(total / 1024 * 10) / 10}MB)`);
console.log("  원본 PNG는 _raw 폴더에 남아 있습니다(다시 구울 때 사용).");
