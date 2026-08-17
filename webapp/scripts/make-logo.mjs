// 가온 로고를 웹용으로 뽑는 스크립트 (2026-08-17)
//   원본: C:\Users\주인님\Desktop\가온 서버 및 정보\가온(개인)\가온로고\투명로고.png (260×216, 투명 PNG)
//   →   public/logo.webp
//
// 사용법:  node scripts/make-logo.mjs "<원본.png>"
//          (경로를 주지 않으면 아래 기본 경로를 쓴다)
//
// ⚠️ 이 로고는 **투명 배경**이다. 히어로 그림들(hero-person.webp 등)과 달리 흰 바탕으로
//    구워져 있지 않으므로 `mix-blend-mode: multiply` 같은 장치가 필요 없다. 그 장치를 여기에
//    따라 붙이면 로고의 파란 심볼이 배경색에 물든다 — 붙이지 말 것.
// ⚠️ 높이 120px로 뽑는 이유: 화면에 그리는 크기가 헤더 40px·푸터 34px이라, 고해상도 화면(3배)에서도
//    선명하도록 가장 큰 표시 크기의 3배를 잡았다. 원본이 216px이므로 줄이기만 한다(늘리지 않는다).
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, "..", "public");
const DEFAULT_SRC =
  "C:\\Users\\주인님\\Desktop\\가온 서버 및 정보\\가온(개인)\\가온로고\\투명로고.png";

const src = process.argv[2] || DEFAULT_SRC;
const out = path.join(OUT_DIR, "logo.webp");

const meta = await sharp(src).metadata();
if (!meta.hasAlpha) {
  console.warn("⚠️ 원본에 투명(알파) 채널이 없다. 흰 네모가 생길 수 있으니 원본을 확인할 것.");
}

await sharp(src)
  // 높이 120에 맞춰 비율 그대로 줄인다. fit: "inside"라 가로도 함께 줄어든다.
  .resize({ height: 120, fit: "inside", withoutEnlargement: true })
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(out);

const done = await sharp(out).metadata();
const kb = (await import("node:fs")).statSync(out).size / 1024;
console.log(
  `→ public/logo.webp  ${done.width}x${done.height}  ${kb.toFixed(1)}KB  (원본 ${meta.width}x${meta.height})`,
);
