// 홈화면(랜딩) 그림을 원본에서 web용으로 굽는 스크립트.
//
// 왜 스크립트로 남기나: 예전에는 변환 절차가 주석 문장으로만 남아, 원본을 지우거나 크기를 바꿔야 할 때
// 다시 만들 수 없었다(2026-08-06 히어로 때 실제로 겪었다). 이 파일이 그 절차의 원본이다.
//
// 쓰는 법 (webapp 폴더에서):
//   node scripts/make-landing-images.mjs "<방패 원본.png>" "<배너 원본.png>"
//   인자를 생략하면 아래 기본 경로(사장님 Downloads)를 쓴다 — 원본이 거기 없으면 경로를 넘겨야 한다.
//
// 원본(2026-08-09 사장님 제작, ChatGPT 이미지):
//   방패 1254×1254 PNG 1.0MB  → public/shield-check.webp  720×720    (화면 표시 240px, 3배까지 선명)
//   배너 1923×818  PNG 1.0MB  → public/cta-band.webp     1867×586   (화면 표시 최대 1032px, 1.8배)
// ⚠️ 원본보다 크게 늘리지 않는다. 늘려 봐야 정보가 늘지 않고 파일만 커진다(예전에 2000px으로 늘렸다가
//    "2배라 선명하다"는 거짓 주석이 붙었다 — 실제 정보량은 잘라낸 1867px 그대로였다).
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_SHIELD = process.argv[2] || "C:/Users/주인님/Downloads/ChatGPT Image 2026년 8월 9일 오전 10_02_45.png";
const SRC_BANNER = process.argv[3] || "C:/Users/주인님/Downloads/ChatGPT Image 2026년 8월 9일 오전 10_04_54.png";
const OUT = path.join(__dirname, "..", "public");

// 두 원본 모두 **흰 배경 위에 그림이 놓인 사진**이다(투명 PNG가 아니다).
// 그래서 "흰색으로 볼 밝기"의 기준이 필요하다. 배경은 254~255, 그림의 가장 옅은 부분(방패 후광)은 246이라
// 240을 기준으로 삼으면 배경만 흰색으로 잡힌다.
const isWhite = (p) => p[0] > 240 && p[1] > 240 && p[2] > 240;

async function readPixels(file) {
  // ⚠️ flatten — **투명 배경(알파) PNG를 넣었을 때 조용히 망가지는 것**을 막는 유일한 방어다.
  //    알파가 있으면 투명한 곳의 RGB가 0,0,0(검정)으로 나와 아래 isWhite가 전부 "그림"이라고 판단하고,
  //    그 결과 자를 범위가 사진 전체가 되어 아무것도 안 잘린 채 결과가 나온다(에러도 안 난다).
  //    흰 배경 위에 얹어 두면 원래 쓰던 흰 배경 원본과 똑같이 처리된다.
  const { data, info } = await sharp(file).flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return { info, at };
}

// 흰색이 아닌 픽셀이 차지하는 사각형(=그림이 실제로 그려진 범위)
async function contentBounds(file) {
  const { info, at } = await readPixels(file);
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (!isWhite(at(x, y))) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { info, at, x0, y0, x1, y1 };
}

async function makeShield() {
  const b = await contentBounds(SRC_SHIELD);
  // **그림의 한가운데를 기준으로** 정사각을 잡는다.
  // ⚠️ 네 변에 똑같은 여백을 주면 안 된다 — 원본에서 그림이 이미 왼쪽으로 61px 치우쳐 있어서,
  //    그 치우침이 결과물에 그대로 남는다(실제로 화면에서 방패가 상자 왼쪽으로 11.5px 쏠렸다 — 검수 지적).
  // ⚠️ 그 전에는 "가운데 80%"로 잘랐는데, 그건 위쪽 후광을 직선으로 잘라 옅은 자국을 남겼다.
  //    그래서 기준이 두 개다: ①그림을 다 담을 것(need) ②사진 밖으로 나가지 말 것(room).
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const need = Math.max(cx - b.x0, b.x1 - cx, cy - b.y0, b.y1 - cy) + 4;      // 그림을 다 담는 데 필요한 반변(+여유 4)
  const room = Math.min(cx, cy, b.info.width - cx, b.info.height - cy);       // 사진이 허용하는 최대 반변
  if (need > room) {
    throw new Error(`방패 원본의 그림이 사진 가장자리에 너무 붙어 있어 가운데 정사각으로 자를 수 없습니다 ` +
      `(필요 ${Math.round(need)}px > 가능 ${Math.round(room)}px). 원본 여백을 넓혀 다시 뽑아 주세요.`);
  }
  const half = Math.round(need);
  const crop = { left: Math.round(cx) - half, top: Math.round(cy) - half, width: half * 2, height: half * 2 };
  await sharp(SRC_SHIELD)
    .flatten({ background: "#ffffff" })
    .extract(crop)
    .resize({ width: 720 })
    .webp({ quality: 86 })
    .toFile(path.join(OUT, "shield-check.webp"));
  return { 그림범위: [b.x0, b.y0, b.x1, b.y1], 그림중심: [Math.round(cx), Math.round(cy)], 자른결과: crop };
}

async function makeBanner() {
  const b = await contentBounds(SRC_BANNER);
  // 배너 원본에는 **둥근 모서리와 그 바깥 흰 여백이 함께 구워져** 있다. 그대로 쓰면 화면에서 네 귀퉁이에
  // 흰 조각이 비친다(CSS가 자기 둥근 모서리로 다시 자르기 때문에 각도가 안 맞는다).
  // → 네 변에 흰 픽셀이 **한 점도 없을 때까지** 안쪽으로 파고든다.
  const edgeHasWhite = (d) => {
    const x0 = b.x0 + d, x1 = b.x1 - d, y0 = b.y0 + d, y1 = b.y1 - d;
    for (let x = x0; x <= x1; x++) if (isWhite(b.at(x, y0)) || isWhite(b.at(x, y1))) return true;
    for (let y = y0; y <= y1; y++) if (isWhite(b.at(x0, y)) || isWhite(b.at(x1, y))) return true;
    return false;
  };
  const LIMIT = 200;
  let d = 0;
  while (d < LIMIT && edgeHasWhite(d)) d++;
  // ⚠️ 여기서 그냥 넘어가면 **흰 조각이 남은 그림**이 아무 말 없이 만들어진다. 200px이나 파고들었는데도
  //    흰 픽셀이 남는다면 원본이 예상과 다른 것이므로(예: 배경이 흰색이 아니거나 여백이 훨씬 크거나)
  //    멈추고 사람이 보게 한다. 임시방편으로 덮지 않는다.
  if (d >= LIMIT) throw new Error(`배너 원본의 흰 여백을 ${LIMIT}px 안으로 잘라도 흰 픽셀이 남습니다. 원본을 확인해 주세요.`);
  const crop = { left: b.x0 + d, top: b.y0 + d, width: (b.x1 - d) - (b.x0 + d) + 1, height: (b.y1 - d) - (b.y0 + d) + 1 };
  await sharp(SRC_BANNER)
    .flatten({ background: "#ffffff" })
    .extract(crop)
    // ⚠️ Math.min — 잘라낸 폭보다 크게 늘리지 않는다(늘려도 선명해지지 않고 파일만 커진다).
    .resize({ width: Math.min(2000, crop.width) })
    .webp({ quality: 82 })
    .toFile(path.join(OUT, "cta-band.webp"));
  return { 파란사각형: [b.x0, b.y0, b.x1, b.y1], 모서리제거: d, 자른결과: crop, 비율: (crop.width / crop.height).toFixed(2) };
}

(async () => {
  for (const f of [SRC_SHIELD, SRC_BANNER]) {
    if (!fs.existsSync(f)) {
      console.error("원본을 찾을 수 없습니다:", f, "\n→ 경로를 인자로 넘겨 주세요.");
      process.exit(1);
    }
  }
  console.log("방패:", JSON.stringify(await makeShield()));
  console.log("배너:", JSON.stringify(await makeBanner()));
  for (const f of ["shield-check.webp", "cta-band.webp"]) {
    const p = path.join(OUT, f);
    const m = await sharp(p).metadata();
    // ⚠️ 실제 저장 경로를 그대로 찍는다("public/…"이라고 고정해 두면 OUT을 바꿨을 때 거짓말이 된다)
    console.log(`→ ${path.relative(process.cwd(), p)}  ${m.width}x${m.height}  ${(fs.statSync(p).size / 1024).toFixed(1)}KB`);
  }
})();
