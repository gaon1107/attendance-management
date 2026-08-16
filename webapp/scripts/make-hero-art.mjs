// 홈화면 히어로 3D 일러스트를 원본에서 web용으로 굽는다.
//   사용(webapp 폴더에서): node scripts/make-hero-art.mjs "<원본.png>"
//   → public/hero-person.webp
//
// ⚠️ 방패(shield-check)·배너(cta-band)는 **다른 파일**이 만든다: scripts/make-landing-images.mjs
//    합치지 않은 이유 — 그 스크립트는 실행할 때마다 방패·배너 원본 두 개를 다시 읽는데,
//    그 원본(2026-08-09)이 지금 다운로드 폴더에 없어서 히어로만 다시 굽고 싶어도 죽는다.
//
// 원본(2026-08-17 사장님 제작, ChatGPT 이미지):
//   1536×1024 PNG 1.2MB — 인물 + 얼굴인식 프레임 + 체크 + 시계 + 위치핀. 배경 흰색(253~255).
//
// ⚠️ **흰 배경으로 구워서 낸다**(투명 PNG가 아니다). 화면에서는 globals.css가 mix-blend-mode: multiply로
//    흰 부분을 지운다 — 이 프로젝트의 기존 방식이다(투명 PNG는 파일이 8배 커진다: 233KB vs 29KB 실측).
//    ⚠️ `.ensureAlpha()`로는 배경이 투명해지지 않는다(알파 채널만 255로 붙고 흰색은 그대로 남는다).
//       실제로 뚫으려면 모서리 실측색 + 허용오차로 가장자리부터 채워 들어가야 한다(role 일러스트 방식).
//       지금은 multiply로 충분해서 그 처리를 하지 않는다 — 필요해지면 그때 더한다.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || "C:/Users/주인님/Downloads/ChatGPT Image 2026년 8월 17일 오전 12_49_16.png";
const OUT = path.join(__dirname, "..", "public");

// 그림 둘레에 남길 여백(px, 원본 기준). 0으로 두면 시계·핀이 상자 변에 딱 붙어 답답해 보인다.
const MARGIN = 16;
// 최종 가로폭. 화면 표시는 2단 히어로에서 약 460~500px이라 2.5배 이상을 확보한다.
// ⚠️ 잘라낸 폭보다 크게 늘리지 않는다(늘려도 선명해지지 않고 파일만 커진다 — 배너 때 겪은 함정).
const TARGET_W = 1280;
const QUALITY = 80;

// 흰색에서 얼마나 벗어났는지(0~255). 배경이 253~255라 3을 넘으면 그림으로 본다.
// ⚠️ 순백(255) 기준으로 잡으면 안 된다 — 원본 배경이 순백이 아니라 거의 아무것도 안 잘린다
//    (2026-08-09 role 일러스트에서 투명 픽셀이 1.7%뿐이었던 사고가 이것이다).
const INK_MIN_DEV = 3;

async function contentBounds(file) {
  // flatten — 투명 PNG를 넣었을 때 투명한 곳이 검정(0,0,0)으로 읽혀 "전부 그림"이 되는 사고를 막는다.
  const { data, info } = await sharp(file).flatten({ background: "#FFFFFF" }).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      if (255 - Math.min(data[i], data[i + 1], data[i + 2]) > INK_MIN_DEV) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error("원본이 전부 흰색입니다 — 그림이 없거나 경로가 잘못됐습니다.");
  return { W, H, x0, y0, x1, y1 };
}

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error("원본을 찾을 수 없습니다:", SRC, "\n→ 경로를 인자로 넘겨 주세요.");
    process.exit(1);
  }
  const b = await contentBounds(SRC);
  // 여백을 주되 사진 밖으로 나가지 않게 자른다(clamp).
  const left = Math.max(0, b.x0 - MARGIN);
  const top = Math.max(0, b.y0 - MARGIN);
  const crop = {
    left, top,
    width: Math.min(b.W, b.x1 + 1 + MARGIN) - left,
    height: Math.min(b.H, b.y1 + 1 + MARGIN) - top,
  };
  const width = Math.min(TARGET_W, crop.width);

  const out = path.join(OUT, "hero-person.webp");
  await sharp(SRC).extract(crop).resize({ width })
    .flatten({ background: "#FFFFFF" })
    .webp({ quality: QUALITY, effort: 6 })
    .toFile(out);

  const m = await sharp(out).metadata();
  console.log("잉크범위:", JSON.stringify([b.x0, b.y0, b.x1, b.y1]), `(원본 ${b.W}x${b.H})`);
  console.log("자른결과:", JSON.stringify(crop), "비율", (crop.width / crop.height).toFixed(3));
  console.log(`→ public/hero-person.webp  ${m.width}x${m.height}  ${kb(out)}KB`);
  // 화면에 그려질 잉크의 좌우 위치 — CSS로 배치할 때 필요하다(globals.css 주석에 옮겨 적을 것).
  const inkL = (b.x0 - left) / crop.width, inkR = (b.x1 + 1 - left) / crop.width;
  console.log(`잉크 가로 위치: 상자 폭의 ${(inkL * 100).toFixed(1)}% ~ ${(inkR * 100).toFixed(1)}%`);
})();
